import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '@automate/db';
import type { HealthGrade } from '@automate/shared-contracts';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  ingestHealthReport,
  listFindings,
  setSupplyChainPolicy,
  triageFinding,
  type RepoHealthOptions,
} from './repo-health-service.js';
import {
  LICENCE_TOOL,
  licenceFindings,
  listComponents,
  provenanceTrust,
  searchPortfolioComponents,
  supplyChainPolicyRecord,
} from './supply-chain-service.js';
import { AUTOMATED_ACCEPTANCE_DAYS } from './health-findings.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function project(db: MigratedDb, workspaceId: string, slug: string): Promise<string> {
  const [row] = await db
    .insert(schema.projects)
    .values({ workspaceId, name: slug, slug, defaultBranch: 'main' })
    .returning({ id: schema.projects.id });
  return (row as { id: string }).id;
}

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options: RepoHealthOptions = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  return { db, options, projectId: await project(db, 'ws-1', 'service') };
}

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const LODASH = 'pkg:npm/lodash@4.17.20';

interface BomOptions {
  analysis?: Record<string, unknown>;
  vulnerabilities?: boolean;
  gplExpression?: string;
}

function bom(options: BomOptions = {}) {
  return json({
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: 'urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79',
    version: 1,
    metadata: { tools: { components: [{ name: 'Trivy', version: '0.50.0' }] } },
    components: [
      {
        'bom-ref': LODASH,
        type: 'library',
        name: 'lodash',
        version: '4.17.20',
        purl: LODASH,
        licenses: [{ license: { id: 'MIT' } }],
      },
      {
        'bom-ref': 'pkg:npm/gpl-thing@1.0.0',
        type: 'library',
        name: 'gpl-thing',
        version: '1.0.0',
        purl: 'pkg:npm/gpl-thing@1.0.0',
        licenses: [{ expression: options.gplExpression ?? 'GPL-3.0-only' }],
      },
      { type: 'framework', name: 'mystery', version: '2.0.0', purl: 'pkg:npm/mystery@2.0.0' },
    ],
    ...(options.vulnerabilities === false
      ? {}
      : {
          vulnerabilities: [
            {
              id: 'CVE-2021-23337',
              description: 'Command injection in template',
              ratings: [{ severity: 'critical' }],
              affects: [{ ref: LODASH }],
              recommendation: 'Upgrade to 4.17.21',
              ...(options.analysis === undefined ? {} : { analysis: options.analysis }),
            },
          ],
        }),
  });
}

function openVex(
  status: string,
  id = 'https://vex.example.test/supplier/1',
  justification = 'vulnerable_code_not_in_execute_path',
) {
  return json({
    '@context': 'https://openvex.dev/ns/v0.2.0',
    '@id': id,
    author: 'Supplier',
    timestamp: '2026-10-20T00:00:00Z',
    statements: [
      {
        vulnerability: { name: 'CVE-2021-23337' },
        products: [{ '@id': 'pkg:npm/lodash' }],
        status,
        ...(status === 'not_affected' ? { justification } : {}),
      },
    ],
  });
}

const fixableCritical = (grade: HealthGrade) =>
  grade.gates.find((gate) => gate.id === 'fixable-critical-vulnerability')?.tripped;

async function upload(
  options: RepoHealthOptions,
  projectId: string,
  format: Parameters<typeof ingestHealthReport>[1]['format'],
  bytes: Uint8Array,
  extra: { branch?: string; digest?: string } = {},
) {
  return ingestHealthReport(options, { projectId, format, bytes, source: 'ci', ...extra });
}

describe('an SBOM upload', () => {
  it('replaces the branch inventory, and brings vulnerabilities into the finding lifecycle', async () => {
    const { options, projectId } = await setup();
    const first = await upload(options, projectId, 'cyclonedx-json', bom());
    expect(first.toolKey).toBe('cyclonedx-json');
    expect(first.findings).toEqual({ new: 1, persisting: 0, fixed: 0 });
    expect(fixableCritical(first.grade)).toBe(true);

    const page = await listComponents(options, projectId, { offset: 0, limit: 10 });
    expect(page.total).toBe(3);
    expect(page.components.map((component) => component.name)).toEqual([
      'gpl-thing',
      'lodash',
      'mystery',
    ]);
    expect(
      (await listComponents(options, projectId, { licence: 'MIT', offset: 0, limit: 10 }))
        .components,
    ).toMatchObject([{ name: 'lodash', licences: ['MIT'] }]);
    expect(
      (await listComponents(options, projectId, { type: 'framework', offset: 0, limit: 10 })).total,
    ).toBe(1);

    // An SPDX inventory replaces the CycloneDX one, and says nothing about vulnerabilities.
    const spdx = await upload(
      options,
      projectId,
      'spdx-json',
      json({
        spdxVersion: 'SPDX-2.3',
        documentNamespace: 'https://spdx.example.test/doc',
        packages: [
          {
            SPDXID: 'SPDXRef-left-pad',
            name: 'left-pad',
            versionInfo: '1.3.0',
            licenseConcluded: 'MIT',
            externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/left-pad@1.3.0' }],
          },
        ],
      }),
    );
    expect(spdx.findings).toEqual({ new: 0, persisting: 0, fixed: 0 });
    const replaced = await listComponents(options, projectId, { offset: 0, limit: 10 });
    expect(replaced.components.map((component) => component.purl)).toEqual([
      'pkg:npm/left-pad@1.3.0',
    ]);
  });

  it('marks a vulnerability fixed when the next analysed BOM no longer has it, and never on an inventory-only BOM', async () => {
    const { options, projectId } = await setup();
    await upload(options, projectId, 'cyclonedx-json', bom());
    const inventoryOnly = await upload(
      options,
      projectId,
      'cyclonedx-json',
      bom({ vulnerabilities: false }),
    );
    expect(inventoryOnly.findings.fixed).toBe(0);
    expect(
      (await listFindings(options, projectId, { state: 'open', limit: 50, offset: 0 })).total,
    ).toBe(1);
  });

  it('records a producer analysis as triage with its reason, and a person outranks it', async () => {
    const { options, projectId } = await setup();
    const result = await upload(
      options,
      projectId,
      'cyclonedx-json',
      bom({ analysis: { state: 'not_affected', justification: 'code_not_reachable' } }),
    );
    expect(fixableCritical(result.grade)).toBe(false);
    const [finding] = (await listFindings(options, projectId, { limit: 50, offset: 0 })).findings;
    expect(finding).toMatchObject({
      state: 'accepted',
      triagedBy: 'sbom:cyclonedx-json',
      triageReason: 'CycloneDX analysis not_affected: code_not_reachable',
      triageExpiresAt: new Date(
        NOW.getTime() + AUTOMATED_ACCEPTANCE_DAYS * 86_400_000,
      ).toISOString(),
    });

    // The producer stops analysing it: the finding is open again.
    await upload(options, projectId, 'cyclonedx-json', bom());
    const reopened = (await listFindings(options, projectId, { limit: 50, offset: 0 })).findings[0];
    expect(reopened).toMatchObject({ state: 'open', triagedBy: null, triageReason: null });

    // A person's suppression is not overwritten by the producer's later analysis.
    await triageFinding(
      options,
      projectId,
      reopened?.id ?? '',
      { state: 'suppressed', reason: 'tracked in JIRA-1' },
      'session',
    );
    await upload(
      options,
      projectId,
      'cyclonedx-json',
      bom({ analysis: { state: 'not_affected', justification: 'code_not_reachable' } }),
    );
    expect(
      (await listFindings(options, projectId, { limit: 50, offset: 0 })).findings[0],
    ).toMatchObject({ state: 'suppressed', triagedBy: 'session' });
  });
});

describe('VEX', () => {
  it('clears a tripped fixable-critical gate, survives a re-scan, and reopens when withdrawn', async () => {
    const { options, projectId } = await setup();
    const scanned = await upload(options, projectId, 'cyclonedx-json', bom());
    expect(fixableCritical(scanned.grade)).toBe(true);

    const vex = await upload(options, projectId, 'vex', openVex('not_affected'));
    expect(vex.toolKey).toBe('vex');
    expect(fixableCritical(vex.grade)).toBe(false);
    const accepted = (await listFindings(options, projectId, { limit: 50, offset: 0 })).findings[0];
    expect(accepted).toMatchObject({
      state: 'accepted',
      triagedBy: 'vex:https://vex.example.test/supplier/1',
      triageReason: 'VEX: vulnerable_code_not_in_execute_path',
    });
    expect(accepted?.triageExpiresAt).not.toBeNull();

    // A re-scan reports the CVE again: it persists, and VEX's acceptance stands.
    const rescan = await upload(options, projectId, 'cyclonedx-json', bom());
    expect(rescan.findings).toEqual({ new: 0, persisting: 1, fixed: 0 });
    expect(fixableCritical(rescan.grade)).toBe(false);

    // The supplier withdraws the statement with a later one.
    const withdrawn = await upload(
      options,
      projectId,
      'vex',
      openVex('under_investigation', 'https://vex.example.test/supplier/2'),
    );
    expect(fixableCritical(withdrawn.grade)).toBe(true);
    expect(
      (await listFindings(options, projectId, { limit: 50, offset: 0 })).findings[0],
    ).toMatchObject({ state: 'open', triagedBy: null });
  });

  it('applies to findings that arrive after the document, and never overrules a person', async () => {
    const { options, projectId } = await setup();
    await upload(options, projectId, 'vex', openVex('not_affected'));
    const later = await upload(options, projectId, 'cyclonedx-json', bom());
    expect(fixableCritical(later.grade)).toBe(false);

    const { db, options: fresh, projectId: other } = await setup();
    await upload(fresh, other, 'cyclonedx-json', bom());
    const [finding] = (await listFindings(fresh, other, { limit: 50, offset: 0 })).findings;
    await triageFinding(
      fresh,
      other,
      finding?.id ?? '',
      { state: 'false_positive', reason: 'not our lodash' },
      'session',
    );
    await upload(fresh, other, 'vex', openVex('affected'));
    const rows = await db
      .select({ state: schema.healthFindings.state, by: schema.healthFindings.triagedBy })
      .from(schema.healthFindings)
      .where(eq(schema.healthFindings.projectId, other));
    expect(rows).toEqual([{ state: 'false_positive', by: 'session' }]);
  });

  it('refuses a document that is neither OpenVEX nor CycloneDX VEX', async () => {
    const { options, projectId } = await setup();
    await expect(upload(options, projectId, 'vex', json({ hello: 'world' }))).rejects.toMatchObject(
      { code: 'INVALID_REQUEST_BODY' },
    );
  });
});

describe('the licence policy', () => {
  it('turns a denied and an unknown licence into findings, and fixes them when the policy changes', async () => {
    const { options, projectId } = await setup();
    await upload(options, projectId, 'cyclonedx-json', bom({ vulnerabilities: false }));
    // No policy: nothing is judged.
    expect(
      (await listFindings(options, projectId, { tool: LICENCE_TOOL, limit: 50, offset: 0 })).total,
    ).toBe(0);

    const saved = await setSupplyChainPolicy(
      options,
      projectId,
      {
        licences: { deny: ['GPL-3.0-only'], failOnUnknown: true },
        provenance: { trustedKeysPem: [], trustedRootsPem: [] },
      },
      'session',
    );
    expect(saved.branches).toEqual(['main']);
    expect(saved.record.policy?.licences.deny).toEqual(['GPL-3.0-only']);
    const judged = await listFindings(options, projectId, {
      tool: LICENCE_TOOL,
      state: 'open',
      limit: 50,
      offset: 0,
    });
    expect(
      judged.findings.map((finding) => [finding.ruleId, finding.path, finding.severity]).sort(),
    ).toEqual([
      ['licence/denied', 'pkg:npm/gpl-thing@1.0.0', 'high'],
      ['licence/unknown', 'pkg:npm/mystery@2.0.0', 'low'],
    ]);

    // Re-uploading the same inventory persists them; it does not create new ones.
    await upload(options, projectId, 'cyclonedx-json', bom({ vulnerabilities: false }));
    expect(
      (await listFindings(options, projectId, { tool: LICENCE_TOOL, limit: 50, offset: 0 })).total,
    ).toBe(2);

    await setSupplyChainPolicy(
      options,
      projectId,
      {
        licences: { failOnUnknown: false },
        provenance: { trustedKeysPem: [], trustedRootsPem: [] },
      },
      'session',
    );
    expect(
      (
        await listFindings(options, projectId, {
          tool: LICENCE_TOOL,
          state: 'open',
          limit: 50,
          offset: 0,
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await listFindings(options, projectId, {
          tool: LICENCE_TOOL,
          state: 'fixed',
          limit: 50,
          offset: 0,
        })
      ).total,
    ).toBe(2);
  });

  it('flags an unlisted licence only when an allow list exists, and reads listed licences as all applying', () => {
    const component = {
      purl: 'pkg:npm/dual@1.0.0',
      name: 'dual',
      version: '1.0.0',
      licences: ['Apache-2.0', 'MIT'],
      licenceExpression: null,
    };
    expect(licenceFindings([component], { failOnUnknown: true })).toEqual([]);
    const [unlisted] = licenceFindings([component], { allow: ['MIT'], failOnUnknown: true });
    expect(unlisted).toMatchObject({ ruleId: 'licence/unlisted', severity: 'medium' });
    expect(unlisted?.message).toContain('Apache-2.0 AND MIT');
    // The fingerprint is the component and its licence text: stable across calls.
    expect(
      licenceFindings([component], { allow: ['MIT'], failOnUnknown: true })[0]?.fingerprint,
    ).toBe(unlisted?.fingerprint);
  });
});

// ─── Provenance ──────────────────────────────────────────────────────────────

const PAYLOAD_TYPE = 'application/vnd.in-toto+json';
const DIGEST = 'a'.repeat(64);
const BUILDER = 'https://github.com/slsa-framework/slsa-github-generator/generic@v2';

function signedProvenance(key: KeyObject): Uint8Array {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'app.tar.gz', digest: { sha256: DIGEST } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: { buildType: 'https://example.test/build/v1' },
      runDetails: { builder: { id: BUILDER } },
    },
  };
  const body = Buffer.from(JSON.stringify(statement));
  const pae = Buffer.concat([
    Buffer.from(
      `DSSEv1 ${String(Buffer.byteLength(PAYLOAD_TYPE))} ${PAYLOAD_TYPE} ${String(body.length)} `,
    ),
    body,
  ]);
  return json({
    payloadType: PAYLOAD_TYPE,
    payload: body.toString('base64'),
    signatures: [{ keyid: 'key-1', sig: sign(null, pae, key).toString('base64') }],
  });
}

const supplyChain = (grade: HealthGrade) =>
  grade.dimensions.find((entry) => entry.dimension === 'supply-chain');

describe('provenance', () => {
  it('is not_configured with no policy, and verified against a trusted key', async () => {
    const { options, projectId } = await setup();
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unconfigured = await upload(
      options,
      projectId,
      'slsa-provenance',
      signedProvenance(privateKey),
    );
    expect(unconfigured.metrics).toBe(1);
    expect(supplyChain(unconfigured.grade)?.summary.join(' ')).toContain(
      'signature not configured',
    );
    expect(supplyChain(unconfigured.grade)?.score).toBeCloseTo(33.3, 1);

    await setSupplyChainPolicy(
      options,
      projectId,
      {
        licences: { failOnUnknown: true },
        provenance: {
          trustedKeysPem: [publicKey.export({ type: 'spki', format: 'pem' }).toString()],
          trustedRootsPem: [],
          allowedBuilders: [BUILDER],
        },
      },
      'session',
    );
    const verified = await upload(
      options,
      projectId,
      'slsa-provenance',
      signedProvenance(privateKey),
      {
        digest: `sha256:${DIGEST}`,
      },
    );
    expect(supplyChain(verified.grade)?.summary.join(' ')).toContain('SLSA L3');
    expect(supplyChain(verified.grade)?.summary.join(' ')).toContain('signature verified');

    // A digest the provenance does not describe is level 0.
    const wrong = await upload(
      options,
      projectId,
      'slsa-provenance',
      signedProvenance(privateKey),
      {
        digest: `sha256:${'b'.repeat(64)}`,
      },
    );
    expect(supplyChain(wrong.grade)?.summary.join(' ')).toContain('SLSA L0');

    // A valid signature on a provenance no digest ties to this artifact proves nothing more.
    const unbound = await upload(
      options,
      projectId,
      'slsa-provenance',
      signedProvenance(privateKey),
    );
    expect(supplyChain(unbound.grade)?.summary.join(' ')).toContain('SLSA L1');
    expect(supplyChain(unbound.grade)?.summary.join(' ')).toContain('signature verified');

    // Another key is not trusted.
    const stranger = generateKeyPairSync('ed25519').privateKey;
    const forged = await upload(options, projectId, 'slsa-provenance', signedProvenance(stranger));
    expect(supplyChain(forged.grade)?.summary.join(' ')).toContain('signature invalid');
  });

  it('requires the digest when the policy says it comes from the upload, and refuses a malformed attestation', async () => {
    const { options, projectId } = await setup();
    await setSupplyChainPolicy(
      options,
      projectId,
      {
        licences: { failOnUnknown: true },
        provenance: {
          trustedKeysPem: [],
          trustedRootsPem: [],
          expectedDigestSource: 'upload-query',
        },
      },
      'session',
    );
    const key = generateKeyPairSync('ed25519').privateKey;
    await expect(
      upload(options, projectId, 'slsa-provenance', signedProvenance(key)),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      upload(options, projectId, 'slsa-provenance', json({ payloadType: PAYLOAD_TYPE })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_BODY' });
  });

  it('passes the service clock and only the configured trust to the verifier', () => {
    expect(provenanceTrust(null, undefined, NOW)).toEqual({
      at: NOW,
      trustedKeysPem: [],
      trustedRootsPem: [],
      trustedIdentities: [],
    });
    const identities = [
      { subject: 'https://github.com/o/r/.github/workflows/r.yml@refs/heads/main' },
    ];
    expect(
      provenanceTrust(
        {
          licences: { failOnUnknown: true },
          provenance: {
            trustedKeysPem: [],
            trustedRootsPem: ['pem'],
            trustedIdentities: identities,
          },
        },
        undefined,
        NOW,
      ).trustedIdentities,
    ).toEqual(identities);
  });
});

describe('workspace isolation', () => {
  it('keeps every supply-chain read and write inside the caller workspace', async () => {
    const { db, options, projectId } = await setup();
    await upload(options, projectId, 'cyclonedx-json', bom());
    const foreignProject = await project(db, 'ws-2', 'foreign');
    const foreign: RepoHealthOptions = { ...options, workspaceId: 'ws-2' };
    await upload(foreign, foreignProject, 'cyclonedx-json', bom());

    // Reads by another workspace's caller find nothing of ws-1's project.
    await expect(
      listComponents(foreign, projectId, { offset: 0, limit: 10 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(supplyChainPolicyRecord(foreign, projectId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      setSupplyChainPolicy(
        foreign,
        projectId,
        {
          licences: { failOnUnknown: true },
          provenance: { trustedKeysPem: [], trustedRootsPem: [] },
        },
        'x',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(upload(foreign, projectId, 'vex', openVex('not_affected'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // The portfolio search sees only the caller's own projects, though both ship lodash.
    const mine = await searchPortfolioComponents(options, 'pkg:npm/lodash', {
      offset: 0,
      limit: 10,
    });
    expect(mine.matches.map((match) => match.projectId)).toEqual([projectId]);
    expect(mine.matches[0]).toMatchObject({
      version: '4.17.20',
      branch: 'main',
      project: 'service',
    });
    const theirs = await searchPortfolioComponents(foreign, 'pkg:npm/', { offset: 0, limit: 10 });
    expect(new Set(theirs.matches.map((match) => match.projectId))).toEqual(
      new Set([foreignProject]),
    );
    expect(theirs.total).toBe(3);

    // A VEX document in ws-2 decides nothing about ws-1's identical finding.
    await upload(foreign, foreignProject, 'vex', openVex('not_affected'));
    const ws1 = await db
      .select({ state: schema.healthFindings.state })
      .from(schema.healthFindings)
      .where(
        and(
          eq(schema.healthFindings.workspaceId, 'ws-1'),
          eq(schema.healthFindings.projectId, projectId),
        ),
      );
    expect(ws1).toEqual([{ state: 'open' }]);
    const stored = await db.select().from(schema.vexDocuments);
    expect(stored.map((row) => row.workspaceId)).toEqual(['ws-2']);

    // A policy in ws-2 is invisible to ws-1, and the reverse.
    await setSupplyChainPolicy(
      foreign,
      foreignProject,
      {
        licences: { deny: ['MIT'], failOnUnknown: true },
        provenance: { trustedKeysPem: [], trustedRootsPem: [] },
      },
      'x',
    );
    expect((await supplyChainPolicyRecord(options, projectId)).policy).toBeNull();
  });

  it('escapes LIKE wildcards in a purl prefix', async () => {
    const { options, projectId } = await setup();
    await upload(options, projectId, 'cyclonedx-json', bom());
    expect(
      (await searchPortfolioComponents(options, 'pkg:npm/%', { offset: 0, limit: 10 })).total,
    ).toBe(0);
  });
});
