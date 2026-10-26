import { createHash } from 'node:crypto';
import type { CanonicalFinding, FindingSeverity } from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES, MAX_SARIF_RESULTS } from './sarif.js';
import { type Json, record, list, text, finite } from './json-fields.js';
import { severityFromCvss } from './cvss.js';

/**
 * Software bills of materials — CycloneDX 1.4–1.6 JSON, SPDX 2.x JSON and SPDX 3.0 JSON-LD —
 * read into one inventory shape.
 *
 * ## One shape, so two formats describing the same packages compare equal
 *
 * Every format names the same few facts differently: a CycloneDX `purl` is an SPDX 2.3
 * `externalRefs[referenceType=purl]` and an SPDX 3.0 `software_packageUrl`; a CycloneDX
 * `licenses[].expression` is an SPDX 2.3 `licenseConcluded` and an SPDX 3.0
 * `hasConcludedLicense` relationship. Each normaliser writes the same {@link SbomComponent},
 * and the list is sorted by purl then name, so equal inventories are equal values whatever
 * order a generator happened to emit. Only `ref` stays format-specific: it is the document's
 * own handle (`bom-ref`, `SPDXID`, `spdxId`), useful for linking back and meaningless across
 * documents.
 *
 * Normalisation, each a decision rather than an accident:
 *
 * - **Hash algorithms** are lower-cased with `-` and `_` removed, so CycloneDX `SHA-256`,
 *   SPDX 2.3 `SHA256` and SPDX 3.0 `sha256` are one name; values are lower-case hex.
 * - **Licences** are the identifiers named, sorted. An expression contributes the licence
 *   identifiers in it (operators, parentheses and `WITH` exceptions removed — an exception is
 *   not a licence), and the expression itself is kept verbatim in `licenceExpression`. A
 *   single listed licence is also its own expression; several listed licences have none,
 *   because CycloneDX does not say whether a list means AND or OR and guessing would invent a
 *   legal claim.
 * - SPDX `NOASSERTION` and `NONE` mean "nobody said", so they produce no licence and no
 *   supplier. `licenseConcluded` wins over `licenseDeclared` when it asserts something.
 * - **Type** is CycloneDX's component `type`, SPDX's primary purpose in kebab case, and
 *   `library` when a document does not say — the common case every generator defaults to.
 *   SPDX 2.3 has no purpose for a model, so a `huggingface` or `mlflow` purl with no purpose
 *   reads as `machine-learning-model`; SPDX 3.0 says so directly (`ai_AIPackage`, purpose
 *   `model`).
 * - CycloneDX nested `components` are flattened; `metadata.component` is the subject of the
 *   BOM, not an item in it, and is not listed.
 *
 * ## Vulnerabilities
 *
 * A CycloneDX BOM may carry `vulnerabilities` (Trivy, Grype and Dependency-Track all write
 * them). Each affected component becomes one `vulnerability` finding in `dependencies`. A
 * vulnerability the producer already analysed as `not_affected`, `false_positive` or
 * `resolved` is **still emitted** — dropping it would make the upload look cleaner than the
 * scanner said — and is also listed in `preTriaged`, so the caller can record the decision
 * with its reason rather than treat it as a fresh open finding. SPDX vulnerability data (the
 * 3.0 security profile) is not read.
 *
 * ## Bounds
 *
 * Input over {@link MAX_HEALTH_REPORT_BYTES} is refused. More than
 * {@link MAX_SBOM_COMPONENTS} components or {@link MAX_SARIF_RESULTS} findings are cut at the
 * cap and `truncated` is set, so a partial inventory can never pass for a complete one.
 */
export const SBOM_ADAPTER_VERSION = '1';

/** Components kept from one document; beyond this the result is `truncated`. */
export const MAX_SBOM_COMPONENTS = 50_000;

export interface SbomHash {
  alg: string;
  value: string;
}

export interface SbomComponent {
  ref: string;
  name: string;
  version: string | null;
  purl: string | null;
  /** `library`, `application`, `framework`, `machine-learning-model`, … */
  type: string;
  /** SPDX identifiers (or licence names) named by the document, sorted and unique. */
  licences: string[];
  licenceExpression: string | null;
  supplier: string | null;
  hashes: SbomHash[];
}

/** A producer's own analysis of a vulnerability, as the triage state it corresponds to. */
export interface PreTriagedFinding {
  fingerprint: string;
  state: 'accepted' | 'false_positive' | 'fixed';
  reason: string;
}

export interface SbomDocument {
  format: 'cyclonedx' | 'spdx';
  specVersion: string;
  serial: string | null;
  components: SbomComponent[];
  findings: CanonicalFinding[];
  preTriaged: PreTriagedFinding[];
  truncated: boolean;
}

function decode(input: Uint8Array, what: string): unknown {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `${what} is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new HealthReportError('malformed', `${what} is not valid JSON`);
  }
}

/** `SPDX`'s two "nobody said" values. */
function asserted(value: unknown): string | null {
  const raw = text(value);
  return raw === null || raw === 'NOASSERTION' || raw === 'NONE' ? null : raw;
}

/** The licence identifiers an SPDX expression names; operators and exceptions are not licences. */
function expressionIds(expression: string): string[] {
  const tokens = expression
    .replace(/[()]/gu, ' ')
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  const ids: string[] = [];
  let exception = false;
  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (exception) exception = false;
    else if (upper === 'WITH') exception = true;
    else if (upper !== 'AND' && upper !== 'OR') ids.push(token);
  }
  return ids;
}

function licencesFrom(
  ids: readonly string[],
  expression: string | null,
): Pick<SbomComponent, 'licences' | 'licenceExpression'> {
  const all = expression === null ? ids : [...ids, ...expressionIds(expression)];
  return {
    licences: [...new Set(all)].sort(),
    licenceExpression: expression ?? (ids.length === 1 ? ids.join('') : null),
  };
}

function hash(alg: unknown, value: unknown): SbomHash | null {
  const name = text(alg);
  const content = text(value);
  if (name === null || content === null) return null;
  return { alg: name.toLowerCase().replace(/[-_]/gu, ''), value: content.toLowerCase() };
}

function hashes(entries: unknown[], read: (entry: Json) => SbomHash | null): SbomHash[] {
  return entries
    .map((entry) => {
      const value = record(entry);
      return value === null ? null : read(value);
    })
    .filter((entry): entry is SbomHash => entry !== null)
    .sort((a, b) => compare(a.alg, b.alg) || compare(a.value, b.value));
}

/** `operatingSystem` and `OPERATING-SYSTEM` are both `operating-system`. */
function kebab(purpose: string): string {
  return purpose
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/_/gu, '-')
    .toLowerCase();
}

const MODEL_PURL = /^pkg:(huggingface|mlflow)\//iu;

function typeFrom(purpose: string | null, purl: string | null): string {
  if (purpose !== null && purpose.toLowerCase() !== 'other') {
    const type = kebab(purpose);
    return type === 'model' ? 'machine-learning-model' : type;
  }
  return purl !== null && MODEL_PURL.test(purl) ? 'machine-learning-model' : 'library';
}

/** Code-unit order, never locale order, so the sort is the same on every host. */
function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sortComponents(components: SbomComponent[]): SbomComponent[] {
  return components.sort(
    (a, b) =>
      compare(a.purl ?? '', b.purl ?? '') ||
      compare(a.name, b.name) ||
      compare(a.version ?? '', b.version ?? '') ||
      compare(a.ref, b.ref),
  );
}

/** Keeps at most {@link MAX_SBOM_COMPONENTS}, and says so when it cut. */
class Inventory {
  readonly components: SbomComponent[] = [];
  truncated = false;

  add(component: SbomComponent | null): void {
    if (component === null) return;
    if (this.components.length >= MAX_SBOM_COMPONENTS) this.truncated = true;
    else this.components.push(component);
  }
}

function fallbackRef(name: string, version: string | null): string {
  return version === null ? name : `${name}@${version}`;
}

// ─── CycloneDX ──────────────────────────────────────────────────────────────

function cycloneDxComponent(component: Json): SbomComponent | null {
  const name = text(component['name']);
  if (name === null) return null;
  const version = text(component['version']);
  const purl = text(component['purl']);
  const ids: string[] = [];
  let expression: string | null = null;
  for (const raw of list(component['licenses'])) {
    const choice = record(raw);
    const licence = record(choice?.['license']);
    const id = text(licence?.['id']) ?? text(licence?.['name']);
    if (id !== null) ids.push(id);
    expression = text(choice?.['expression']) ?? expression;
  }
  return {
    ref: text(component['bom-ref']) ?? purl ?? fallbackRef(name, version),
    name,
    version,
    purl,
    type: text(component['type']) ?? 'library',
    ...licencesFrom(ids, expression),
    supplier: text(record(component['supplier'])?.['name']),
    hashes: hashes(list(component['hashes']), (entry) => hash(entry['alg'], entry['content'])),
  };
}

function walkComponents(raw: unknown[], visit: (component: Json) => void): void {
  for (const entry of raw) {
    const component = record(entry);
    if (component === null) continue;
    visit(component);
    walkComponents(list(component['components']), visit);
  }
}

/** CycloneDX 1.4 lists tools as an array; 1.5 and later as `{ components, services }`. */
function cycloneDxTool(metadata: Json | null): string {
  const tools = metadata?.['tools'];
  const first = record(list(record(tools)?.['components'] ?? tools)[0]);
  return text(first?.['name'])?.toLowerCase().split(/\s+/u)[0]?.slice(0, 100) ?? 'cyclonedx';
}

const SEVERITY_ORDER: readonly FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** The worst rating wins; a rating with only a CVSS score is banded the way SARIF's is. */
function highestSeverity(ratings: unknown[]): FindingSeverity {
  let best = SEVERITY_ORDER.length - 1;
  for (const raw of ratings) {
    const rating = record(raw);
    const named = text(rating?.['severity'])?.toLowerCase() ?? null;
    const score = finite(rating?.['score']);
    let severity: FindingSeverity | null = null;
    if (named !== null && (SEVERITY_ORDER as readonly string[]).includes(named)) {
      severity = named as FindingSeverity;
    } else if (named === null && score !== null) {
      severity = severityFromCvss(score);
    }
    if (severity !== null) best = Math.min(best, SEVERITY_ORDER.indexOf(severity));
  }
  return SEVERITY_ORDER[best];
}

const NO_FIX_RESPONSES = new Set(['can_not_fix', 'will_not_fix']);

function fixAvailableFor(vulnerability: Json, analysis: Json | null): boolean | null {
  const responses = list(analysis?.['response']);
  if (responses.some((response) => NO_FIX_RESPONSES.has(String(response)))) return false;
  const fixedVersion = list(vulnerability['affects']).some((affect) =>
    list(record(affect)?.['versions']).some(
      (version) => record(version)?.['status'] === 'unaffected',
    ),
  );
  if (text(vulnerability['recommendation']) !== null || fixedVersion) return true;
  return responses.includes('update') ? true : null;
}

const ANALYSIS_TRIAGE: Readonly<Record<string, PreTriagedFinding['state']>> = {
  not_affected: 'accepted',
  false_positive: 'false_positive',
  resolved: 'fixed',
  resolved_with_pedigree: 'fixed',
};

interface Affected {
  path: string | null;
  label: string | null;
}

function affectedOf(vulnerability: Json, byRef: ReadonlyMap<string, SbomComponent>): Affected[] {
  const affected = list(vulnerability['affects']).map((raw): Affected => {
    const ref = text(record(raw)?.['ref']);
    const component = ref === null ? undefined : byRef.get(ref);
    if (component !== undefined) {
      return {
        path: component.purl ?? component.ref,
        label: fallbackRef(component.name, component.version),
      };
    }
    return ref?.startsWith('pkg:') === true
      ? { path: ref, label: ref }
      : { path: null, label: null };
  });
  return affected.length > 0 ? affected : [{ path: null, label: null }];
}

function vulnerabilityFindings(
  vulnerability: Json,
  tool: string,
  byRef: ReadonlyMap<string, SbomComponent>,
): { finding: CanonicalFinding; triage: PreTriagedFinding | null }[] {
  const id = text(vulnerability['id']);
  if (id === null) return [];
  const analysis = record(vulnerability['analysis']);
  const state = text(analysis?.['state']);
  const triageState = state === null ? undefined : ANALYSIS_TRIAGE[state];
  const description = text(vulnerability['description']) ?? text(vulnerability['detail']) ?? id;
  const helpUri =
    text(record(vulnerability['source'])?.['url']) ??
    text(record(list(vulnerability['advisories'])[0])?.['url']);
  const severity = highestSeverity(list(vulnerability['ratings']));
  const fixAvailable = fixAvailableFor(vulnerability, analysis);
  return affectedOf(vulnerability, byRef).map(({ path, label }) => {
    const fingerprint = createHash('sha256')
      .update(`cyclonedx-vulnerability\u0000${id}\u0000${path ?? ''}`)
      .digest('hex');
    return {
      finding: {
        fingerprint,
        tool,
        ruleId: id.slice(0, 300),
        kind: 'vulnerability',
        severity,
        dimension: 'dependencies',
        path: path?.slice(0, 1000) ?? null,
        line: null,
        message: (label === null
          ? `${id}: ${description}`
          : `${id} in ${label}: ${description}`
        ).slice(0, 4000),
        helpUri: helpUri?.slice(0, 2000) ?? null,
        fixAvailable,
      },
      triage:
        triageState === undefined || state === null
          ? null
          : {
              fingerprint,
              state: triageState,
              reason: `CycloneDX analysis ${state}: ${
                text(analysis?.['justification']) ??
                text(analysis?.['detail']) ??
                'no justification given'
              }`.slice(0, 2000),
            },
    };
  });
}

/**
 * A CycloneDX 1.4–1.6 JSON BOM as an inventory, plus any vulnerabilities it carries.
 *
 * @throws HealthReportError `too_large` over the byte cap; `malformed` when it is not a
 *   CycloneDX JSON document with a `specVersion`.
 */
export function parseCycloneDx(input: Uint8Array): SbomDocument {
  const document = record(decode(input, 'CycloneDX BOM'));
  const specVersion = text(document?.['specVersion']);
  if (document === null || document['bomFormat'] !== 'CycloneDX' || specVersion === null) {
    throw new HealthReportError('malformed', 'not a CycloneDX JSON BOM with a specVersion');
  }

  const inventory = new Inventory();
  const byRef = new Map<string, SbomComponent>();
  walkComponents(list(document['components']), (raw) => {
    const component = cycloneDxComponent(raw);
    if (component !== null) byRef.set(component.ref, component);
    inventory.add(component);
  });

  const tool = cycloneDxTool(record(document['metadata']));
  const findings = new Map<string, CanonicalFinding>();
  const preTriaged = new Map<string, PreTriagedFinding>();
  let truncated = inventory.truncated;
  for (const raw of list(document['vulnerabilities'])) {
    const vulnerability = record(raw);
    if (vulnerability === null) continue;
    for (const { finding, triage } of vulnerabilityFindings(vulnerability, tool, byRef)) {
      if (findings.size >= MAX_SARIF_RESULTS) {
        truncated = true;
        break;
      }
      findings.set(finding.fingerprint, finding);
      if (triage !== null) preTriaged.set(triage.fingerprint, triage);
    }
  }

  return {
    format: 'cyclonedx',
    specVersion,
    serial: text(document['serialNumber']),
    components: sortComponents(inventory.components),
    findings: [...findings.values()],
    preTriaged: [...preTriaged.values()],
    truncated,
  };
}

// ─── SPDX 2.x ───────────────────────────────────────────────────────────────

/** `Organization: Acme` and `Person: Jane` are both a supplier called by their name. */
function spdx2Supplier(value: unknown): string | null {
  const raw = asserted(value);
  return raw === null ? null : raw.replace(/^(Organization|Person|Tool):\s*/u, '');
}

function spdx2Component(pkg: Json): SbomComponent | null {
  const name = text(pkg['name']);
  if (name === null) return null;
  const version = text(pkg['versionInfo']);
  const purl =
    list(pkg['externalRefs'])
      .map(record)
      .filter((ref) => ref?.['referenceType'] === 'purl')
      .map((ref) => text(ref?.['referenceLocator']))
      .find((locator) => locator !== null) ?? null;
  const expression = asserted(pkg['licenseConcluded']) ?? asserted(pkg['licenseDeclared']);
  return {
    ref: text(pkg['SPDXID']) ?? fallbackRef(name, version),
    name,
    version,
    purl,
    type: typeFrom(text(pkg['primaryPackagePurpose']), purl),
    ...licencesFrom([], expression),
    supplier: spdx2Supplier(pkg['supplier']),
    hashes: hashes(list(pkg['checksums']), (entry) =>
      hash(entry['algorithm'], entry['checksumValue']),
    ),
  };
}

function parseSpdx2(document: Json, specVersion: string): SbomDocument {
  if (!Array.isArray(document['packages'])) {
    throw new HealthReportError('malformed', 'SPDX 2 document has no packages array');
  }
  const inventory = new Inventory();
  for (const raw of document['packages']) {
    const pkg = record(raw);
    inventory.add(pkg === null ? null : spdx2Component(pkg));
  }
  return {
    format: 'spdx',
    specVersion,
    serial: text(document['documentNamespace']),
    components: sortComponents(inventory.components),
    findings: [],
    preTriaged: [],
    truncated: inventory.truncated,
  };
}

// ─── SPDX 3.0 ───────────────────────────────────────────────────────────────

const SPDX3_CONTEXT = /spdx\.org\/rdf\/(3\.[0-9.]*[0-9])\//u;
const LISTED_LICENCE = 'https://spdx.org/licenses/';
const NO_LICENCE = /\/(NoAssertionLicense|NoneLicense)$/u;
const PACKAGE_TYPES = new Set(['software_Package', 'ai_AIPackage', 'dataset_DatasetPackage']);

/** JSON-LD lets `type`/`@type` and `spdxId`/`@id` stand for each other; SPDX writes the short forms. */
function typeOf(element: Json): string | null {
  return text(element['type']) ?? text(element['@type']);
}

function idOf(element: Json): string | null {
  return text(element['spdxId']) ?? text(element['@id']);
}

class Spdx3Graph {
  readonly byId = new Map<string, Json>();
  /** `from` → relationship type → `to` ids, in document order. */
  readonly relationships = new Map<string, Map<string, string[]>>();

  constructor(elements: readonly Json[]) {
    for (const element of elements) {
      const id = idOf(element);
      if (id !== null) this.byId.set(id, element);
      if (typeOf(element) !== 'Relationship') continue;
      const from = text(element['from']);
      const kind = text(element['relationshipType']);
      if (from === null || kind === null) continue;
      const byKind = this.relationships.get(from) ?? new Map<string, string[]>();
      const targets = list(element['to']).map(text);
      byKind.set(kind, [
        ...(byKind.get(kind) ?? []),
        ...targets.filter((target): target is string => target !== null),
      ]);
      this.relationships.set(from, byKind);
    }
  }

  /** A licence target as an SPDX expression; the two "no licence" individuals are none. */
  licenceText(id: string): string | null {
    if (NO_LICENCE.test(id)) return null;
    const element = this.byId.get(id);
    if (element !== undefined) {
      const expression =
        text(element['simplelicensing_licenseExpression']) ??
        text(element['expandedlicensing_licenseId']);
      if (expression !== null) return expression;
    }
    return id.startsWith(LISTED_LICENCE) ? id.slice(LISTED_LICENCE.length) : id;
  }

  licence(from: string, kind: string): string | null {
    const parts = (this.relationships.get(from)?.get(kind) ?? [])
      .map((target) => this.licenceText(target))
      .filter((part): part is string => part !== null);
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts.join('') : parts.map((part) => `(${part})`).join(' AND ');
  }
}

function spdx3Purl(element: Json): string | null {
  return (
    text(element['software_packageUrl']) ??
    list(element['externalIdentifier'])
      .map(record)
      .filter((identifier) => identifier?.['externalIdentifierType'] === 'packageUrl')
      .map((identifier) => text(identifier?.['identifier']))
      .find((identifier) => identifier !== null) ??
    null
  );
}

function spdx3Component(element: Json, graph: Spdx3Graph): SbomComponent | null {
  const name = text(element['name']);
  const id = idOf(element);
  if (name === null || id === null) return null;
  const version = text(element['software_packageVersion']);
  const purl = spdx3Purl(element);
  const supplierId = text(element['suppliedBy']);
  const purpose =
    typeOf(element) === 'ai_AIPackage' ? 'model' : text(element['software_primaryPurpose']);
  const expression =
    graph.licence(id, 'hasConcludedLicense') ?? graph.licence(id, 'hasDeclaredLicense');
  return {
    ref: id,
    name,
    version,
    purl,
    type: typeFrom(purpose, purl),
    ...licencesFrom([], expression),
    supplier: supplierId === null ? null : text(graph.byId.get(supplierId)?.['name']),
    hashes: hashes(list(element['verifiedUsing']), (entry) =>
      typeOf(entry) === 'Hash' ? hash(entry['algorithm'], entry['hashValue']) : null,
    ),
  };
}

function parseSpdx3(document: Json, graphElements: unknown[]): SbomDocument {
  // A context may be an array mixing URLs and inline objects; only the URLs name a version.
  const contexts = [document['@context']]
    .flat()
    .filter((context): context is string => typeof context === 'string')
    .join(' ');
  const contextVersion = SPDX3_CONTEXT.exec(contexts)?.[1];
  if (contextVersion === undefined) {
    throw new HealthReportError('unsupported', 'JSON-LD document is not SPDX 3');
  }
  const elements = graphElements.map(record).filter((element): element is Json => element !== null);
  const graph = new Spdx3Graph(elements);
  const inventory = new Inventory();
  let specVersion = contextVersion;
  let serial: string | null = null;
  for (const element of elements) {
    const type = typeOf(element);
    if (type === 'CreationInfo') specVersion = text(element['specVersion']) ?? specVersion;
    else if (type === 'SpdxDocument') serial = idOf(element);
    else if (type !== null && PACKAGE_TYPES.has(type))
      inventory.add(spdx3Component(element, graph));
  }
  return {
    format: 'spdx',
    specVersion,
    serial,
    components: sortComponents(inventory.components),
    findings: [],
    preTriaged: [],
    truncated: inventory.truncated,
  };
}

/**
 * An SPDX document as an inventory: SPDX 2.x JSON (`spdxVersion: "SPDX-2.3"`) or SPDX 3.0
 * JSON-LD (`@context` naming `spdx.org/rdf/3.x`), told apart by those two markers.
 *
 * @throws HealthReportError `too_large` over the byte cap; `unsupported` for SPDX 1 or a
 *   JSON-LD document that is not SPDX 3; `malformed` for anything else.
 */
export function parseSpdx(input: Uint8Array): SbomDocument {
  const document = record(decode(input, 'SPDX document'));
  const spdxVersion = text(document?.['spdxVersion']);
  if (document !== null && spdxVersion !== null) {
    const version = /^SPDX-(2\.\d+)$/u.exec(spdxVersion)?.[1];
    if (version === undefined) {
      throw new HealthReportError('unsupported', `${spdxVersion} is not SPDX 2 or 3`);
    }
    return parseSpdx2(document, version);
  }
  const graph = document?.['@graph'];
  if (document !== null && Array.isArray(graph)) return parseSpdx3(document, graph);
  throw new HealthReportError('malformed', 'not an SPDX 2 JSON or SPDX 3 JSON-LD document');
}
