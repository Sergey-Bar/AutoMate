import { createHash } from 'node:crypto';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';
import { type Json, record, list, text, strings } from './json-fields.js';

/**
 * VEX — a supplier's statement about whether a vulnerability affects their product — read
 * from OpenVEX 0.2.0 (and the earlier `openvex.dev/ns` drafts) or CycloneDX VEX, and applied
 * to the findings a scanner reported.
 *
 * ## One statement shape for both formats
 *
 * OpenVEX states one of four statuses directly. CycloneDX VEX says the same things as an
 * `analysis.state`, mapped here the way CycloneDX's own VEX guidance maps them:
 *
 * | CycloneDX `analysis.state`            | VEX status            |
 * | ------------------------------------- | --------------------- |
 * | `not_affected`                        | `not_affected`        |
 * | `false_positive`                      | `not_affected`, justification `false_positive` |
 * | `resolved`, `resolved_with_pedigree`  | `fixed`               |
 * | `exploitable`                         | `affected`            |
 * | `in_triage`                           | `under_investigation` |
 *
 * A vulnerability with no analysis, or a state outside that table, makes no statement: VEX
 * is a claim somebody made, and inventing one would be ours.
 *
 * Products are purls. An OpenVEX product's `subcomponents` are listed beside it, because a
 * finding names the dependency (the subcomponent) rather than the product that ships it.
 * A CycloneDX `affects[].ref` is resolved through the BOM's own components to their purl;
 * an unresolved ref is kept verbatim, so a BOM-Link still matches a finding that names it.
 *
 * ## Identity
 *
 * The document id is OpenVEX's `@id`, or CycloneDX `serialNumber/version`. A document with
 * neither gets `sha256:<digest of its bytes>`, so the same file re-uploaded is the same
 * author of the same decisions — never a random id that would make every upload a stranger.
 */
export const VEX_ADAPTER_VERSION = '1';

export type VexStatus = 'not_affected' | 'affected' | 'fixed' | 'under_investigation';

export interface VexStatement {
  vulnerability: string;
  aliases: string[];
  /** purls, or a verbatim reference where the document gave something else. */
  products: string[];
  status: VexStatus;
  justification: string | null;
  impact: string | null;
}

export interface VexDocument {
  id: string;
  author: string | null;
  timestamp: string | null;
  statements: VexStatement[];
}

/** The part of a stored finding VEX needs to decide on it. */
export interface VexFinding {
  fingerprint: string;
  ruleId: string;
  /** The affected package's purl, as dependency findings carry it. */
  path: string | null;
  state: string;
  /** Who last triaged it; `vex:<id>` when a VEX document did. */
  triagedBy?: string | null;
}

export interface VexDecision {
  fingerprint: string;
  state: 'accepted' | 'fixed' | 'open';
  reason: string;
  triagedBy: string;
}

const STATUSES: ReadonlySet<string> = new Set([
  'not_affected',
  'affected',
  'fixed',
  'under_investigation',
]);

function contentId(input: Uint8Array): string {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
}

// ─── OpenVEX ────────────────────────────────────────────────────────────────

/** A product is a purl string (the 0.0.x drafts) or an object naming one by `@id` or identifier. */
function productIds(raw: unknown): string[] {
  if (typeof raw === 'string') return strings([raw]);
  const product = record(raw);
  if (product === null) return [];
  const own = text(product['@id']) ?? text(record(product['identifiers'])?.['purl']);
  return [...strings([own]), ...list(product['subcomponents']).flatMap(productIds)];
}

function openVexStatement(raw: unknown): VexStatement | null {
  const statement = record(raw);
  const status = text(statement?.['status']);
  if (statement === null || status === null || !STATUSES.has(status)) return null;
  const rawVulnerability = statement['vulnerability'];
  const vulnerability = record(rawVulnerability);
  const name = text(rawVulnerability) ?? text(vulnerability?.['name']);
  if (name === null) return null;
  return {
    vulnerability: name,
    aliases: strings(list(vulnerability?.['aliases'])),
    products: list(statement['products']).flatMap(productIds),
    status: status as VexStatus,
    justification: text(statement['justification']),
    impact: text(statement['impact_statement']),
  };
}

function parseOpenVex(document: Json, input: Uint8Array): VexDocument {
  if (!Array.isArray(document['statements'])) {
    throw new HealthReportError('malformed', 'OpenVEX document has no statements array');
  }
  return {
    id: text(document['@id']) ?? contentId(input),
    author: text(document['author']),
    timestamp: text(document['timestamp']),
    statements: document['statements']
      .map(openVexStatement)
      .filter((statement): statement is VexStatement => statement !== null),
  };
}

// ─── CycloneDX VEX ──────────────────────────────────────────────────────────

const CYCLONEDX_STATES: Readonly<
  Record<string, { status: VexStatus; justification: string | null }>
> = {
  not_affected: { status: 'not_affected', justification: null },
  false_positive: { status: 'not_affected', justification: 'false_positive' },
  resolved: { status: 'fixed', justification: null },
  resolved_with_pedigree: { status: 'fixed', justification: null },
  exploitable: { status: 'affected', justification: null },
  in_triage: { status: 'under_investigation', justification: null },
};

function cycloneDxStatement(raw: unknown, purls: ReadonlyMap<string, string>): VexStatement | null {
  const vulnerability = record(raw);
  const id = text(vulnerability?.['id']);
  const analysis = record(vulnerability?.['analysis']);
  const mapped = CYCLONEDX_STATES[text(analysis?.['state']) ?? ''];
  if (vulnerability === null || id === null || mapped === undefined) return null;
  return {
    vulnerability: id,
    aliases: strings(list(vulnerability['references']).map((ref) => record(ref)?.['id'])),
    products: strings(
      list(vulnerability['affects']).map((affect) => {
        const ref = text(record(affect)?.['ref']);
        return ref === null ? null : (purls.get(ref) ?? ref);
      }),
    ),
    status: mapped.status,
    justification: text(analysis?.['justification']) ?? mapped.justification,
    impact: text(analysis?.['detail']),
  };
}

function bomRefPurls(components: unknown[], into: Map<string, string>): Map<string, string> {
  for (const raw of components) {
    const component = record(raw);
    const ref = text(component?.['bom-ref']);
    const purl = text(component?.['purl']);
    if (ref !== null && purl !== null) into.set(ref, purl);
    bomRefPurls(list(component?.['components']), into);
  }
  return into;
}

function parseCycloneDxVex(document: Json, input: Uint8Array): VexDocument {
  const metadata = record(document['metadata']);
  const serial = text(document['serialNumber']);
  const version = document['version'];
  const purls = bomRefPurls(list(document['components']), new Map());
  let id = contentId(input);
  if (serial !== null) id = typeof version === 'number' ? `${serial}/${String(version)}` : serial;
  return {
    id,
    author:
      text(record(list(metadata?.['authors'])[0])?.['name']) ??
      text(record(metadata?.['supplier'])?.['name']),
    timestamp: text(metadata?.['timestamp']),
    statements: list(document['vulnerabilities'])
      .map((vulnerability) => cycloneDxStatement(vulnerability, purls))
      .filter((statement): statement is VexStatement => statement !== null),
  };
}

/**
 * An OpenVEX or CycloneDX VEX document, told apart by OpenVEX's `@context` and CycloneDX's
 * `bomFormat`.
 *
 * @throws HealthReportError `too_large` over the byte cap; `unsupported` for JSON that is
 *   neither; `malformed` for invalid JSON or an OpenVEX document with no statements.
 */
export function parseVex(input: Uint8Array): VexDocument {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `VEX document is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new HealthReportError('malformed', 'VEX document is not valid JSON');
  }
  const document = record(parsed);
  if (document === null) throw new HealthReportError('malformed', 'VEX document is not an object');
  if (document['bomFormat'] === 'CycloneDX') return parseCycloneDxVex(document, input);
  if (text(document['@context'])?.startsWith('https://openvex.dev/ns') === true) {
    return parseOpenVex(document, input);
  }
  throw new HealthReportError('unsupported', 'neither an OpenVEX nor a CycloneDX VEX document');
}

// ─── Applying VEX ───────────────────────────────────────────────────────────

interface PackageUrl {
  /** `type/namespace/name`, type lower-cased and escapes decoded. */
  base: string;
  version: string | null;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A purl without its qualifiers and subpath, which name a build or a file inside the package
 * rather than which package it is. The version is after the last `@` of the final segment, so
 * an unescaped npm scope (`@babel/core`) is not read as one.
 */
function packageUrl(value: string): PackageUrl | null {
  if (!value.startsWith('pkg:')) return null;
  const rest = value.slice(4).split('#')[0].split('?')[0];
  const at = rest.indexOf('@', rest.lastIndexOf('/') + 1);
  const path = at === -1 ? rest : rest.slice(0, at);
  const slash = path.indexOf('/');
  // `pkg:type` with no name is not a package; compare it as the text it is.
  if (slash === -1) return null;
  return {
    base: `${path.slice(0, slash).toLowerCase()}${decoded(path.slice(slash))}`,
    version: at === -1 ? null : decoded(rest.slice(at + 1)),
  };
}

/** A version-less product names every version of the package; a versioned one only that version. */
function productMatches(path: string, product: string): boolean {
  const found = packageUrl(path);
  const stated = packageUrl(product);
  if (found === null || stated === null) return path === product;
  return (
    found.base === stated.base && (stated.version === null || stated.version === found.version)
  );
}

function statementMatches(finding: VexFinding, statement: VexStatement): boolean {
  const { path } = finding;
  if (path === null) return false;
  const rule = finding.ruleId.toLowerCase();
  const named = [statement.vulnerability, ...statement.aliases].some(
    (id) => id.toLowerCase() === rule,
  );
  return named && statement.products.some((product) => productMatches(path, product));
}

function decisionFor(statement: VexStatement): Pick<VexDecision, 'state' | 'reason'> {
  switch (statement.status) {
    case 'not_affected':
      return {
        state: 'accepted',
        reason: `VEX: ${statement.justification ?? statement.impact ?? 'not_affected'}`,
      };
    case 'fixed':
      return { state: 'fixed', reason: 'VEX: fixed' };
    case 'affected':
    case 'under_investigation':
      return { state: 'open', reason: `VEX: ${statement.status}` };
  }
}

/**
 * What VEX decides for each finding it speaks about.
 *
 * - A finding matches a statement when its `ruleId` is the vulnerability or one of its
 *   aliases (case-insensitively — `GHSA-…` ids are written both ways) **and** its path matches
 *   one of the statement's products by purl.
 * - Documents are given oldest first, and within a document later statements come later; the
 *   **latest** matching statement wins. So a supplier who withdraws `not_affected` with a
 *   later `affected` or `under_investigation` re-opens the finding.
 * - Only a finding that is `open`, or that a VEX document triaged before (`triagedBy`
 *   `vex:…`), is touched. A person's decision and a scan's `fixed` outrank a supplier's
 *   claim, and VEX never overrules them.
 * - An `open` finding that VEX says is affected gets no decision: it is already open.
 */
export function applyVex(
  findings: readonly VexFinding[],
  documents: readonly VexDocument[],
): VexDecision[] {
  const decisions: VexDecision[] = [];
  for (const finding of findings) {
    const decision = vexDecision(finding, documents);
    if (decision !== null) decisions.push(decision);
  }
  return decisions;
}

/** The latest statement, across documents in order, that speaks about the finding. */
function latestStatement(
  finding: VexFinding,
  documents: readonly VexDocument[],
): { document: VexDocument; statement: VexStatement } | null {
  let latest: { document: VexDocument; statement: VexStatement } | null = null;
  for (const document of documents) {
    for (const statement of document.statements) {
      if (statementMatches(finding, statement)) latest = { document, statement };
    }
  }
  return latest;
}

/** One finding's decision, or `null` when VEX may not touch it or has nothing new to say. */
function vexDecision(finding: VexFinding, documents: readonly VexDocument[]): VexDecision | null {
  const byVex = finding.triagedBy?.startsWith('vex:') === true;
  if (finding.state !== 'open' && !byVex) return null;
  const latest = latestStatement(finding, documents);
  if (latest === null) return null;
  const decision = decisionFor(latest.statement);
  if (decision.state === 'open' && finding.state === 'open') return null;
  return {
    fingerprint: finding.fingerprint,
    ...decision,
    triagedBy: `vex:${latest.document.id}`,
  };
}
