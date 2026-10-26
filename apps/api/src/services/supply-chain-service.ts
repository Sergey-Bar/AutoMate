import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, isNotNull, like, or, sql, type SQL } from 'drizzle-orm';
import {
  healthFindings,
  projects,
  sbomComponents,
  supplyChainPolicies,
  vexDocuments,
} from '@automate/db';
import {
  applyVex,
  type PreTriagedFinding,
  type ProvenancePolicy,
  type SbomComponent,
  type VexDocument,
  type VexFinding,
} from '@automate/reporter';
import { evaluateLicence } from '@automate/reporting';
import {
  SupplyChainPolicySchema,
  type CanonicalFinding,
  type FindingSeverity,
  type PortfolioComponentsPage,
  type SbomComponentsPage,
  type SupplyChainPolicy,
  type SupplyChainPolicyRecord,
} from '@automate/shared-contracts';
import { z } from 'zod/v4';
import {
  INSERT_CHUNK,
  automatedAcceptanceExpiry,
  branchFor,
  projectRow,
  syncFindings,
  type HealthStoreOptions,
  type SyncResult,
} from './health-findings.js';

/**
 * Supply chain: the SBOM inventory, VEX, the licence policy and provenance trust.
 *
 * ## Three automated deciders, and who outranks whom
 *
 * A person's triage is never overwritten by any of them. An SBOM producer's own analysis
 * (`preTriaged`, triaged by `sbom:<tool key>`) and a VEX statement (triaged by `vex:<id>`)
 * each only touch a finding that is `open` or that the same kind of decider triaged before —
 * so a supplier cannot reopen what an operator accepted, and an operator who re-decides a
 * VEX-accepted finding takes it out of VEX's hands for good.
 *
 * ## An automated acceptance expires, and is renewed by being re-asserted
 *
 * See `automatedAcceptanceExpiry`: the contract's "an accepted risk needs an expiry" holds
 * for machine decisions too, with a date that is renewed on every upload that re-applies the
 * statement behind it.
 */
export const LICENCE_TOOL = 'automate-licence';
const SBOM_TRIAGE_PREFIX = 'sbom:';
const VEX_TRIAGE_PREFIX = 'vex:';

// ─── The policy ──────────────────────────────────────────────────────────────

export async function readSupplyChainPolicy(
  options: HealthStoreOptions,
  projectId: string,
): Promise<{ policy: SupplyChainPolicy; updatedAt: Date; updatedBy: string } | null> {
  const rows = await options.db
    .select()
    .from(supplyChainPolicies)
    .where(
      and(
        eq(supplyChainPolicies.workspaceId, options.workspaceId),
        eq(supplyChainPolicies.projectId, projectId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  const parsed = SupplyChainPolicySchema.safeParse(row.policy);
  // A stored policy this version cannot read is no policy, never a half-read one.
  return parsed.success
    ? { policy: parsed.data, updatedAt: row.updatedAt, updatedBy: row.updatedBy }
    : null;
}

export async function supplyChainPolicyRecord(
  options: HealthStoreOptions,
  projectId: string,
): Promise<SupplyChainPolicyRecord> {
  const project = await projectRow(options, projectId);
  const stored = await readSupplyChainPolicy(options, project.id);
  return {
    projectId: project.id,
    policy: stored?.policy ?? null,
    updatedAt: stored?.updatedAt.toISOString() ?? null,
    updatedBy: stored?.updatedBy ?? null,
  };
}

/** Writes the policy; the caller re-evaluates licences and records the grade. */
export async function writeSupplyChainPolicy(
  options: HealthStoreOptions,
  projectId: string,
  policy: SupplyChainPolicy,
  actor: string,
  now: Date,
): Promise<void> {
  await options.db
    .insert(supplyChainPolicies)
    .values({
      workspaceId: options.workspaceId,
      projectId,
      policy: policy as unknown as Record<string, unknown>,
      updatedBy: actor,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [supplyChainPolicies.workspaceId, supplyChainPolicies.projectId],
      set: {
        policy: policy as unknown as Record<string, unknown>,
        updatedBy: actor,
        updatedAt: now,
      },
    });
}

// ─── The inventory ───────────────────────────────────────────────────────────

/** Replaces the project's inventory on the branch with this document's components. */
export async function replaceSbomInventory(
  options: HealthStoreOptions,
  input: {
    projectId: string;
    branch: string;
    reportId: string;
    components: readonly SbomComponent[];
    now: Date;
  },
): Promise<void> {
  await options.db
    .delete(sbomComponents)
    .where(
      and(
        eq(sbomComponents.workspaceId, options.workspaceId),
        eq(sbomComponents.projectId, input.projectId),
        eq(sbomComponents.branch, input.branch),
      ),
    );
  for (let start = 0; start < input.components.length; start += INSERT_CHUNK) {
    await options.db.insert(sbomComponents).values(
      input.components.slice(start, start + INSERT_CHUNK).map((component) => ({
        workspaceId: options.workspaceId,
        projectId: input.projectId,
        branch: input.branch,
        reportId: input.reportId,
        purl: component.purl,
        name: component.name,
        version: component.version,
        type: component.type,
        licences: component.licences,
        licenceExpression: component.licenceExpression,
        supplier: component.supplier,
        createdAt: input.now,
      })),
    );
  }
}

/** Whether a CycloneDX BOM carries a vulnerability analysis at all, as opposed to none found. */
export function carriesVulnerabilityAnalysis(bytes: Uint8Array): boolean {
  try {
    const document: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return (
      typeof document === 'object' &&
      document !== null &&
      Array.isArray((document as Record<string, unknown>)['vulnerabilities'])
    );
  } catch {
    return false;
  }
}

export interface ComponentFilters {
  branch?: string | undefined;
  type?: string | undefined;
  licence?: string | undefined;
  offset: number;
  limit: number;
}

export async function listComponents(
  options: HealthStoreOptions,
  projectId: string,
  filters: ComponentFilters,
): Promise<SbomComponentsPage> {
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, filters.branch);
  const conditions: SQL[] = [
    eq(sbomComponents.workspaceId, options.workspaceId),
    eq(sbomComponents.projectId, project.id),
    eq(sbomComponents.branch, branch),
  ];
  if (filters.type !== undefined) conditions.push(eq(sbomComponents.type, filters.type));
  if (filters.licence !== undefined) {
    conditions.push(sql`${sbomComponents.licences} @> ${JSON.stringify([filters.licence])}::jsonb`);
  }
  const where = and(...conditions);
  const [rows, totals] = await Promise.all([
    options.db
      .select()
      .from(sbomComponents)
      .where(where)
      .orderBy(
        asc(sbomComponents.purl),
        asc(sbomComponents.name),
        asc(sbomComponents.version),
        asc(sbomComponents.id),
      )
      .limit(filters.limit)
      .offset(filters.offset),
    options.db.select({ total: count() }).from(sbomComponents).where(where),
  ]);
  return {
    branch,
    components: rows.map((row) => ({
      purl: row.purl,
      name: row.name,
      version: row.version,
      type: row.type,
      licences: row.licences,
      licenceExpression: row.licenceExpression,
      supplier: row.supplier,
      branch: row.branch,
      reportId: row.reportId,
    })),
    total: Number(totals[0]?.total ?? 0),
    offset: filters.offset,
    limit: filters.limit,
  };
}

function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

/**
 * Every project in the caller's workspace that ships a component whose purl starts with
 * `purl`: the "where do we use log4j" question. The workspace is the first condition, on both
 * the component and the project it is joined to.
 */
export async function searchPortfolioComponents(
  options: HealthStoreOptions,
  purl: string,
  page: { offset: number; limit: number },
): Promise<PortfolioComponentsPage> {
  const where = and(
    eq(sbomComponents.workspaceId, options.workspaceId),
    eq(projects.workspaceId, options.workspaceId),
    isNotNull(sbomComponents.purl),
    like(sbomComponents.purl, likePrefix(purl)),
  );
  const columns = {
    projectId: sbomComponents.projectId,
    project: projects.name,
    slug: projects.slug,
    branch: sbomComponents.branch,
    purl: sbomComponents.purl,
    name: sbomComponents.name,
    version: sbomComponents.version,
  };
  const [rows, totals] = await Promise.all([
    options.db
      .selectDistinct(columns)
      .from(sbomComponents)
      .innerJoin(projects, eq(projects.id, sbomComponents.projectId))
      .where(where)
      .orderBy(
        asc(projects.name),
        asc(sbomComponents.branch),
        asc(sbomComponents.purl),
        asc(sbomComponents.name),
        asc(sbomComponents.version),
        asc(sbomComponents.projectId),
      )
      .limit(page.limit)
      .offset(page.offset),
    options.db
      .select({
        total: sql<number>`count(DISTINCT (${sbomComponents.projectId}, ${sbomComponents.branch}, ${sbomComponents.purl}, ${sbomComponents.name}, ${sbomComponents.version}))`,
      })
      .from(sbomComponents)
      .innerJoin(projects, eq(projects.id, sbomComponents.projectId))
      .where(where),
  ]);
  return {
    matches: rows.map((row) => ({ ...row, purl: row.purl ?? '' })),
    total: Number(totals[0]?.total ?? 0),
    offset: page.offset,
    limit: page.limit,
  };
}

// ─── A producer's own analysis ───────────────────────────────────────────────

/**
 * Records a CycloneDX producer's `not_affected` / `false_positive` / `resolved` analysis as
 * the triage it corresponds to, with the producer's reason.
 *
 * Only an `open` finding, or one this producer triaged before, is decided; a finding the
 * producer stops analysing goes back to `open` (or `fixed`, when the report no longer has it).
 */
export async function applyPreTriage(
  options: HealthStoreOptions,
  input: {
    projectId: string;
    branch: string;
    toolKey: string;
    preTriaged: readonly PreTriagedFinding[];
    present: ReadonlySet<string>;
    now: Date;
  },
): Promise<number> {
  const triagedBy = `${SBOM_TRIAGE_PREFIX}${input.toolKey}`;
  const scope = and(
    eq(healthFindings.workspaceId, options.workspaceId),
    eq(healthFindings.projectId, input.projectId),
    eq(healthFindings.branch, input.branch),
    eq(healthFindings.toolKey, input.toolKey),
  );
  const rows = await options.db
    .select({
      fingerprint: healthFindings.fingerprint,
      state: healthFindings.state,
      triagedBy: healthFindings.triagedBy,
    })
    .from(healthFindings)
    .where(scope);
  const byFingerprint = new Map(rows.map((row) => [row.fingerprint, row]));
  const decided = new Set<string>();
  let applied = 0;
  for (const triage of input.preTriaged) {
    const row = byFingerprint.get(triage.fingerprint);
    if (row === undefined || (row.state !== 'open' && row.triagedBy !== triagedBy)) continue;
    decided.add(triage.fingerprint);
    await options.db
      .update(healthFindings)
      .set({
        state: triage.state,
        triageReason: triage.reason,
        triagedBy,
        triageExpiresAt: triage.state === 'accepted' ? automatedAcceptanceExpiry(input.now) : null,
      })
      .where(and(scope, eq(healthFindings.fingerprint, triage.fingerprint)));
    applied += 1;
  }
  for (const row of rows) {
    if (row.triagedBy !== triagedBy || decided.has(row.fingerprint)) continue;
    await options.db
      .update(healthFindings)
      .set({
        state: input.present.has(row.fingerprint) ? 'open' : 'fixed',
        triageReason: null,
        triagedBy: null,
        triageExpiresAt: null,
      })
      .where(and(scope, eq(healthFindings.fingerprint, row.fingerprint)));
  }
  return applied;
}

// ─── VEX ─────────────────────────────────────────────────────────────────────

const StoredStatementsSchema = z.array(
  z.object({
    vulnerability: z.string(),
    aliases: z.array(z.string()),
    products: z.array(z.string()),
    status: z.enum(['not_affected', 'affected', 'fixed', 'under_investigation']),
    justification: z.string().nullable(),
    impact: z.string().nullable(),
  }),
);

/**
 * Stores a VEX document; a re-upload of the same id replaces it and moves it last.
 *
 * "Last" has to be strict, because the latest statement wins: two uploads in the same
 * millisecond would otherwise tie on `received_at` and be ordered by a random id. So the
 * stored time is at least one millisecond after the newest document already held.
 */
export async function storeVexDocument(
  options: HealthStoreOptions,
  input: { projectId: string; document: VexDocument; reportId: string; now: Date },
): Promise<void> {
  const newest = await options.db
    .select({ receivedAt: vexDocuments.receivedAt })
    .from(vexDocuments)
    .where(
      and(
        eq(vexDocuments.workspaceId, options.workspaceId),
        eq(vexDocuments.projectId, input.projectId),
      ),
    )
    .orderBy(desc(vexDocuments.receivedAt))
    .limit(1);
  const floor = newest[0] === undefined ? 0 : newest[0].receivedAt.getTime() + 1;
  const receivedAt = new Date(Math.max(input.now.getTime(), floor));
  const values = {
    author: input.document.author?.slice(0, 500) ?? null,
    issuedAt: input.document.timestamp?.slice(0, 100) ?? null,
    statements: input.document.statements as unknown[],
    reportId: input.reportId,
    receivedAt,
  };
  await options.db
    .insert(vexDocuments)
    .values({
      workspaceId: options.workspaceId,
      projectId: input.projectId,
      documentId: input.document.id.slice(0, 1000),
      ...values,
    })
    .onConflictDoUpdate({
      target: [vexDocuments.workspaceId, vexDocuments.projectId, vexDocuments.documentId],
      set: values,
    });
}

/**
 * Applies every stored VEX document for the project, oldest upload first, to its open and
 * previously VEX-triaged findings on every branch. Returns how many findings it decided.
 *
 * Run after every VEX, SBOM and SARIF upload, so a re-scan that reports a finding again does
 * not reopen what VEX said is not affected: the re-scan keeps the triage (a decision is never
 * overwritten by a report) and this renews it.
 */
export async function applyStoredVex(
  options: HealthStoreOptions,
  projectId: string,
  now: Date,
): Promise<number> {
  const stored = await options.db
    .select()
    .from(vexDocuments)
    .where(
      and(eq(vexDocuments.workspaceId, options.workspaceId), eq(vexDocuments.projectId, projectId)),
    )
    .orderBy(asc(vexDocuments.receivedAt), asc(vexDocuments.id));
  if (stored.length === 0) return 0;
  const documents: VexDocument[] = stored.map((row) => {
    const statements = StoredStatementsSchema.safeParse(row.statements);
    return {
      id: row.documentId,
      author: row.author,
      timestamp: row.issuedAt,
      statements: statements.success ? statements.data : [],
    };
  });
  const project = and(
    eq(healthFindings.workspaceId, options.workspaceId),
    eq(healthFindings.projectId, projectId),
  );
  const vexOwned = like(healthFindings.triagedBy, `${VEX_TRIAGE_PREFIX}%`);
  const eligible = or(eq(healthFindings.state, 'open'), vexOwned);
  const rows = await options.db
    .select({
      branch: healthFindings.branch,
      fingerprint: healthFindings.fingerprint,
      ruleId: healthFindings.ruleId,
      path: healthFindings.path,
      state: healthFindings.state,
      triagedBy: healthFindings.triagedBy,
    })
    .from(healthFindings)
    .where(and(project, isNotNull(healthFindings.path), eligible));
  const byBranch = new Map<string, VexFinding[]>();
  for (const row of rows) {
    const list = byBranch.get(row.branch) ?? [];
    list.push(row);
    byBranch.set(row.branch, list);
  }
  let decided = 0;
  for (const [branch, findings] of byBranch) {
    for (const decision of applyVex(findings, documents)) {
      const set =
        decision.state === 'open'
          ? { state: 'open', triageReason: null, triagedBy: null, triageExpiresAt: null }
          : {
              state: decision.state,
              triageReason: decision.reason.slice(0, 2000),
              triagedBy: decision.triagedBy.slice(0, 1000),
              triageExpiresAt:
                decision.state === 'accepted' ? automatedAcceptanceExpiry(now) : null,
            };
      await options.db
        .update(healthFindings)
        .set(set)
        .where(
          and(
            project,
            eq(healthFindings.branch, branch),
            eq(healthFindings.fingerprint, decision.fingerprint),
            // Re-checked in the write, so a person who triaged it meanwhile still wins.
            eligible,
          ),
        );
      decided += 1;
    }
  }
  return decided;
}

// ─── Licences ────────────────────────────────────────────────────────────────

const LICENCE_SEVERITY: Readonly<Record<'denied' | 'unlisted' | 'unknown', FindingSeverity>> = {
  denied: 'high',
  unlisted: 'medium',
  unknown: 'low',
};

export interface LicensedComponent {
  purl: string | null;
  name: string;
  version: string | null;
  licences: readonly string[];
  licenceExpression: string | null;
}

/** The expression a component is judged by; listed licences with none are read as all applying. */
function judgedExpression(component: LicensedComponent): string | null {
  if (component.licenceExpression !== null) return component.licenceExpression;
  return component.licences.length === 0 ? null : component.licences.join(' AND ');
}

function labelOf(component: LicensedComponent): string {
  return component.version === null ? component.name : `${component.name}@${component.version}`;
}

/** A violation, or `null` when the policy allows the expression or does not judge unknowns. */
function licenceFinding(
  component: LicensedComponent,
  rules: { allow?: readonly string[]; deny?: readonly string[] },
  failOnUnknown: boolean,
): CanonicalFinding | null {
  const expression = judgedExpression(component);
  const evaluation = evaluateLicence(expression, rules);
  if (evaluation.verdict === 'allowed') return null;
  if (evaluation.verdict === 'unknown' && !failOnUnknown) return null;
  const identity = component.purl ?? labelOf(component);
  return {
    fingerprint: createHash('sha256')
      .update(`${LICENCE_TOOL}\u0000${identity}\u0000${expression ?? ''}`)
      .digest('hex'),
    tool: LICENCE_TOOL,
    ruleId: `licence/${evaluation.verdict}`,
    kind: 'issue',
    severity: LICENCE_SEVERITY[evaluation.verdict],
    dimension: 'dependencies',
    path: identity.slice(0, 1000),
    line: null,
    message:
      `${labelOf(component)} (${expression ?? 'no licence declared'}): ${evaluation.reason}`.slice(
        0,
        4000,
      ),
    helpUri: null,
    fixAvailable: null,
  };
}

/**
 * The licence violations in an inventory, as findings in Dependencies.
 *
 * A component with several listed licences and no expression is read as needing all of them
 * (`AND`): CycloneDX does not say which, and the conservative reading can only add a
 * violation a reviewer then accepts, never hide one. The fingerprint is the component and the
 * licence text, so the finding persists while that pair ships and is fixed when either changes
 * or the policy allows it.
 */
export function licenceFindings(
  components: readonly LicensedComponent[],
  policy: SupplyChainPolicy['licences'],
): CanonicalFinding[] {
  const rules = {
    ...(policy.allow === undefined ? {} : { allow: policy.allow }),
    ...(policy.deny === undefined ? {} : { deny: policy.deny }),
  };
  const findings = new Map<string, CanonicalFinding>();
  for (const component of components) {
    const finding = licenceFinding(component, rules, policy.failOnUnknown);
    if (finding !== null) findings.set(finding.fingerprint, finding);
  }
  return [...findings.values()];
}

/** Evaluates the branch's inventory against the policy and carries the violations forward. */
export async function evaluateBranchLicences(
  options: HealthStoreOptions,
  input: { projectId: string; branch: string; policy: SupplyChainPolicy; now: Date },
): Promise<SyncResult> {
  const components = await options.db
    .select({
      purl: sbomComponents.purl,
      name: sbomComponents.name,
      version: sbomComponents.version,
      licences: sbomComponents.licences,
      licenceExpression: sbomComponents.licenceExpression,
    })
    .from(sbomComponents)
    .where(
      and(
        eq(sbomComponents.workspaceId, options.workspaceId),
        eq(sbomComponents.projectId, input.projectId),
        eq(sbomComponents.branch, input.branch),
      ),
    );
  return syncFindings(options, {
    projectId: input.projectId,
    branch: input.branch,
    toolKey: LICENCE_TOOL,
    findings: licenceFindings(components, input.policy.licences),
    reportId: null,
    now: input.now,
  });
}

/** Branches with an inventory or with licence findings: what a policy change re-evaluates. */
export async function licenceBranches(
  options: HealthStoreOptions,
  projectId: string,
): Promise<string[]> {
  const [inventory, judged] = await Promise.all([
    options.db
      .selectDistinct({ branch: sbomComponents.branch })
      .from(sbomComponents)
      .where(
        and(
          eq(sbomComponents.workspaceId, options.workspaceId),
          eq(sbomComponents.projectId, projectId),
        ),
      ),
    options.db
      .selectDistinct({ branch: healthFindings.branch })
      .from(healthFindings)
      .where(
        and(
          eq(healthFindings.workspaceId, options.workspaceId),
          eq(healthFindings.projectId, projectId),
          eq(healthFindings.toolKey, LICENCE_TOOL),
        ),
      ),
  ]);
  return [...new Set([...inventory, ...judged].map((row) => row.branch))].sort();
}

// ─── Provenance ──────────────────────────────────────────────────────────────

/**
 * The trust a provenance upload is verified against. No policy is an empty trust set, so a
 * signature is `not_configured` and never `verified`.
 */
export function provenanceTrust(
  policy: SupplyChainPolicy | null,
  digest: { alg: string; value: string } | undefined,
  at: Date,
): ProvenancePolicy {
  const provenance = policy?.provenance;
  return {
    at,
    trustedKeysPem: provenance?.trustedKeysPem ?? [],
    trustedRootsPem: provenance?.trustedRootsPem ?? [],
    trustedIdentities: provenance?.trustedIdentities ?? [],
    ...(provenance?.allowedBuilders === undefined
      ? {}
      : { allowedBuilders: provenance.allowedBuilders }),
    ...(digest === undefined ? {} : { expectedDigests: [digest] }),
  };
}
