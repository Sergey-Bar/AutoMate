import { createHash } from 'node:crypto';
import type {
  CanonicalFinding,
  FindingKind,
  FindingSeverity,
  HealthDimension,
  HealthTool,
} from '@automate/shared-contracts';

/**
 * SARIF 2.1.0 → canonical findings.
 *
 * ## One adapter for most of the health dimensions
 *
 * Semgrep (`--sarif`), gitleaks (`--report-format sarif`), Trivy (`--format sarif`),
 * OSV-Scanner (`--format sarif`), CodeQL, Bandit, gosec, ESLint's SARIF formatter, Ruff and
 * golangci-lint all write SARIF. Reading the one format means a new scanner is a row in a
 * table rather than a parser.
 *
 * ## Classification is from what the tool said, never from the source
 *
 * Kind and dimension come from the tool family and the rule's own tags (`secret`,
 * `vulnerability`, `security`, `misconfiguration`, a CWE). Severity comes from the rule's
 * `security-severity` (CVSS) when it has one, otherwise from the SARIF `level`.
 *
 * ## Identity
 *
 * The fingerprint is the tool's own `partialFingerprints` when present — that is what SARIF
 * defines them for. Otherwise it is a hash of tool, rule, path and the normalised snippet or
 * message, and deliberately **not** the line, so a finding does not become "new" because a
 * line was added above it.
 */
export const SARIF_ADAPTER_VERSION = '1';

/** A SARIF upload larger than this is refused before it is parsed. */
export const MAX_HEALTH_REPORT_BYTES = 50 * 1024 * 1024;
/** More results than this in one upload is refused rather than truncated: a partial scan reads as clean. */
export const MAX_SARIF_RESULTS = 20_000;

export type HealthReportErrorCode = 'malformed' | 'too_large' | 'unsupported';

export class HealthReportError extends Error {
  constructor(
    readonly code: HealthReportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HealthReportError';
  }
}

/** A scanner that ran, and the dimensions its silence is a measurement of. */
export interface ScannerRun {
  tool: HealthTool;
  dimensions: readonly HealthDimension[];
}

export interface ParsedFindings {
  tools: ScannerRun[];
  findings: CanonicalFinding[];
}

const SECRET_TOOLS = new Set(['gitleaks', 'trufflehog', 'detect-secrets']);
/** Every rule these ship is a security rule. */
const SECURITY_ONLY_TOOLS = new Set(['bandit', 'gosec', 'brakeman', 'njsscan']);
/** Security analysers that also ship quality rules, told apart by each rule's tags. */
const SECURITY_TOOLS = new Set(['semgrep', 'codeql', ...SECURITY_ONLY_TOOLS]);
const DEPENDENCY_TOOLS = new Set(['osv-scanner', 'npm-audit', 'pip-audit', 'govulncheck']);
const VULNERABILITY_ID = /^(CVE|GHSA|PYSEC|GO|RUSTSEC|OSV|DSA|RHSA|USN)-/iu;

/** Which dimensions a tool's run measures, so a clean run is a 100 rather than nothing. */
function familyDimensions(tool: string): HealthDimension[] {
  if (SECRET_TOOLS.has(tool) || SECURITY_TOOLS.has(tool)) return ['security'];
  if (DEPENDENCY_TOOLS.has(tool)) return ['dependencies'];
  if (tool === 'trivy') return ['security', 'dependencies'];
  return ['code-quality'];
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function decode(input: Uint8Array): Json {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `SARIF is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new HealthReportError('malformed', 'SARIF is not valid JSON');
  }
  const document = record(parsed);
  if (document === null || !Array.isArray(document['runs'])) {
    throw new HealthReportError('malformed', 'SARIF has no runs array');
  }
  const version = document['version'];
  if (version !== undefined && version !== '2.1.0') {
    throw new HealthReportError('unsupported', `SARIF version ${String(version)} is not 2.1.0`);
  }
  return document;
}

function tagsOf(...sources: (Json | null)[]): string[] {
  return sources.flatMap((source) =>
    list(record(source?.['properties'])?.['tags']).filter(
      (tag): tag is string => typeof tag === 'string',
    ),
  );
}

function securitySeverity(...sources: (Json | null)[]): number | null {
  for (const source of sources) {
    const raw = record(source?.['properties'])?.['security-severity'];
    const value = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function severityFromCvss(score: number): FindingSeverity {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'info';
}

const LEVEL_SEVERITY: Readonly<Record<string, FindingSeverity>> = {
  error: 'high',
  warning: 'medium',
  note: 'low',
  none: 'info',
};

function classify(
  tool: string,
  ruleId: string,
  tags: readonly string[],
  hasCvss: boolean,
): { kind: FindingKind; dimension: HealthDimension } {
  const lower = tags.map((tag) => tag.toLowerCase());
  if (SECRET_TOOLS.has(tool) || lower.includes('secret'))
    return { kind: 'secret', dimension: 'security' };
  if (
    DEPENDENCY_TOOLS.has(tool) ||
    lower.includes('vulnerability') ||
    VULNERABILITY_ID.test(ruleId)
  ) {
    return { kind: 'vulnerability', dimension: 'dependencies' };
  }
  if (lower.includes('license')) return { kind: 'issue', dimension: 'dependencies' };
  if (
    SECURITY_ONLY_TOOLS.has(tool) ||
    hasCvss ||
    lower.some(
      (tag) =>
        tag === 'security' ||
        tag === 'misconfiguration' ||
        tag.startsWith('cwe-') ||
        tag.includes('cwe'),
    )
  ) {
    return { kind: 'issue', dimension: 'security' };
  }
  return { kind: 'issue', dimension: 'code-quality' };
}

/** Trivy writes `Fixed Version: 1.2.3` into its message; an empty value means no fix. */
function fixAvailable(result: Json, message: string): boolean | null {
  if (list(result['fixes']).length > 0) return true;
  const match = /Fixed Version:\s*([^\s\n]*)/u.exec(message);
  if (match === null) return null;
  return (match[1] ?? '').length > 0;
}

/** `file:///C:/x` ? `C:/x`, `file:///x` ? `/x`, backslashes to slashes, escapes decoded. */
function plainPath(uri: string): string {
  let path = uri.replace(/^file:\/\//u, '').replace(/\\/gu, '/');
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape is kept as written; the path is display text, never opened.
  }
  return path.replace(/^\/([A-Za-z]:\/)/u, '$1');
}

/**
 * A repository-relative path, so the same finding fingerprints the same on every host.
 *
 * ESLint and OSV-Scanner write absolute `file://` URIs. The prefix is cut at a root the
 * caller knows (the runner's checkout, or the CI workspace) or one the SARIF itself declares
 * in `originalUriBaseIds`; a path neither explains is kept as written rather than guessed at.
 */
function normalisePath(uri: string | null, roots: readonly string[]): string | null {
  if (uri === null) return null;
  let path = plainPath(uri);
  for (const root of roots) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (path.toLowerCase().startsWith(prefix.toLowerCase())) {
      path = path.slice(prefix.length);
      break;
    }
  }
  return path.replace(/^\.\//u, '').slice(0, 1000);
}

function declaredRoots(run: Json | null): string[] {
  const bases = record(run?.['originalUriBaseIds']);
  if (bases === null) return [];
  return Object.values(bases)
    .map((base) => text(record(base)?.['uri']))
    .filter((uri): uri is string => uri !== null && uri.startsWith('file:'))
    .map(plainPath);
}

function fingerprint(
  tool: string,
  ruleId: string,
  result: Json,
  path: string | null,
  message: string,
): string {
  const partial = record(result['partialFingerprints']) ?? record(result['fingerprints']);
  const hash = createHash('sha256').update(`${tool}\u0000${ruleId}\u0000`);
  if (partial !== null && Object.keys(partial).length > 0) {
    for (const key of Object.keys(partial).sort())
      hash.update(`${key}=${String(partial[key])}\u0000`);
  } else {
    const region = record(
      record(record(list(result['locations'])[0])?.['physicalLocation'])?.['region'],
    );
    const snippet = text(record(region?.['snippet'])?.['text']) ?? message;
    hash.update(`${path ?? ''}\u0000${snippet.replace(/\s+/gu, ' ').trim()}`);
  }
  return hash.digest('hex');
}

export interface SarifOptions {
  /** The checkout the scanner ran in, so absolute paths become repository-relative. */
  sourceRoot?: string;
}

/** One SARIF run's driver: the tool, its rules, and where its paths are relative to. */
interface RunContext {
  toolName: string;
  rules: (Json | null)[];
  ruleById: Map<string | null, Json>;
  roots: string[];
}

function ruleFor(context: RunContext, result: Json): Json | null {
  const index = result['ruleIndex'];
  return (
    (typeof index === 'number' ? context.rules[index] : undefined) ??
    context.ruleById.get(text(result['ruleId'])) ??
    context.ruleById.get(text(record(result['rule'])?.['id'])) ??
    null
  );
}

/** A leaked secret is never "medium" because the scanner left the level out. */
function severityOf(
  kind: FindingKind,
  cvss: number | null,
  result: Json,
  rule: Json | null,
): FindingSeverity {
  if (kind === 'secret') return 'high';
  if (cvss !== null) return severityFromCvss(cvss);
  const level =
    text(result['level']) ?? text(record(rule?.['defaultConfiguration'])?.['level']) ?? 'warning';
  return LEVEL_SEVERITY[level] ?? 'medium';
}

function lineOf(physical: Json | null): number | null {
  const startLine = record(physical?.['region'])?.['startLine'];
  return typeof startLine === 'number' && Number.isInteger(startLine) && startLine >= 1
    ? startLine
    : null;
}

/** One SARIF result as a canonical finding. */
function findingFrom(context: RunContext, result: Json): CanonicalFinding {
  const rule = ruleFor(context, result);
  const ruleId = (text(result['ruleId']) ?? text(rule?.['id']) ?? 'unknown').slice(0, 300);
  const message = (
    text(record(result['message'])?.['text']) ??
    text(record(rule?.['shortDescription'])?.['text']) ??
    ruleId
  ).slice(0, 4000);
  const cvss = securitySeverity(result, rule);
  const { kind, dimension } = classify(
    context.toolName,
    ruleId,
    tagsOf(result, rule),
    cvss !== null,
  );
  const physical = record(record(list(result['locations'])[0])?.['physicalLocation']);
  const path = normalisePath(text(record(physical?.['artifactLocation'])?.['uri']), context.roots);
  return {
    fingerprint: fingerprint(context.toolName, ruleId, result, path, message),
    tool: context.toolName,
    ruleId,
    kind,
    severity: severityOf(kind, cvss, result, rule),
    dimension,
    path,
    line: lineOf(physical),
    message,
    helpUri: text(rule?.['helpUri'])?.slice(0, 2000) ?? null,
    fixAvailable: kind === 'vulnerability' ? fixAvailable(result, message) : null,
  };
}

function runContext(
  run: Json | null,
  options: SarifOptions,
): RunContext & { version: string | null } {
  const driver = record(record(run?.['tool'])?.['driver']);
  // `Semgrep OSS` and `semgrep` are one tool; the first word is the family.
  const toolName =
    (text(driver?.['name']) ?? 'unknown').toLowerCase().split(/\s+/u)[0]?.slice(0, 100) ??
    'unknown';
  const rules = list(driver?.['rules']).map(record);
  return {
    toolName,
    version: text(driver?.['semanticVersion']) ?? text(driver?.['version']),
    rules,
    ruleById: new Map(
      rules.filter((rule) => rule !== null).map((rule) => [text(rule['id']), rule]),
    ),
    roots: [
      ...(options.sourceRoot === undefined ? [] : [plainPath(options.sourceRoot)]),
      ...declaredRoots(run),
    ],
  };
}

export function parseSarif(input: Uint8Array, options: SarifOptions = {}): ParsedFindings {
  const document = decode(input);
  const tools = new Map<string, ScannerRun>();
  const findings = new Map<string, CanonicalFinding>();
  let seen = 0;

  for (const rawRun of list(document['runs'])) {
    const run = record(rawRun);
    const context = runContext(run, options);
    const dimensions = new Set(familyDimensions(context.toolName));
    for (const rawResult of list(run?.['results'])) {
      seen += 1;
      if (seen > MAX_SARIF_RESULTS) {
        throw new HealthReportError(
          'too_large',
          `SARIF has more than ${String(MAX_SARIF_RESULTS)} results`,
        );
      }
      const result = record(rawResult);
      if (result === null) continue;
      const finding = findingFrom(context, result);
      dimensions.add(finding.dimension);
      findings.set(finding.fingerprint, finding);
    }
    const key = `${context.toolName}@${context.version ?? ''}`;
    const existing = tools.get(key);
    tools.set(key, {
      tool: { name: context.toolName, version: context.version },
      dimensions: [...new Set([...(existing?.dimensions ?? []), ...dimensions])],
    });
  }
  return { tools: [...tools.values()], findings: [...findings.values()] };
}
