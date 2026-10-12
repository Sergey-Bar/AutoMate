import type { RepositoryView } from './detect/repository-view.js';
import { QA_TOOLS_REGISTRY } from './tool-catalog.js';

/**
 * The toolchain probe: what a repository says about the tools in it.
 *
 * ## Why the probe is a module here and not a list in the client
 *
 * The browser used to carry a hard-coded ten-path file list, so "what is
 * missing from this stack" was answered by whatever the client had imagined the
 * repository to be. The probe reads the repository through the same
 * `RepositoryView` port the detector uses, so the answer is evidence and a test
 * can drive it from a literal map.
 *
 * ## Evidence before claims
 *
 * Every detection carries the string that proved it: a path that matched a
 * detect pattern, or a manifest entry naming the package. A tool that is not
 * detected is `detected: false` with `evidence: null` — never a fabricated
 * path, because the coverage figure is computed from this join and a row nobody
 * can check would be a number nobody can trust.
 */

/** One tool's answer, with the evidence that supports it. */
export interface ToolchainDetection {
  toolId: string;
  detected: boolean;
  evidence: string | null;
  /** The version the repository declares, when it declares one. */
  version: string | null;
}

/**
 * What the probe reads besides the repository.
 *
 * The repository is the authority; `env` carries only what the repository cannot
 * state — a tool installed globally on the runner, or pinned by the environment
 * rather than a manifest. An override is a claim about the environment, and it
 * is recorded in the evidence line so a reader can tell the two apart.
 */
export interface ToolchainEnv {
  readonly versions?: Readonly<Record<string, string>>;
}

/**
 * Manifests the probe reads, in the order it prefers them.
 *
 * A repository in one ecosystem almost never has two of these, so the order is
 * a tie-break rather than a priority. Each entry names the parser that reads it,
 * because `package.json` and `requirements.txt` have nothing in common but the
 * name "manifest".
 */
const MANIFESTS: readonly string[] = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'pom.xml',
];

/**
 * The dependency names a manifest declares, as `{ name, version }` pairs.
 *
 * **A best-effort reader per ecosystem, and it says which.** A full parser per
 * ecosystem is a package of its own; what the probe needs is "does this manifest
 * declare this tool, and at what version", and each reader below answers that
 * for its format. A malformed manifest yields no pairs rather than a throw: a
 * probe that crashes on a repository it cannot read tells the API nothing, while
 * one that answers "detected: false" lets the screen say so.
 */
async function readManifestDeclarations(
  view: RepositoryView,
): Promise<ReadonlyMap<string, { version: string | null; source: string }>> {
  const found = new Map<string, { version: string | null; source: string }>();
  for (const manifest of MANIFESTS) {
    const content = await view.read(manifest);
    if (content === null) continue;
    for (const [name, version] of parseManifest(manifest, content)) {
      const existing = found.get(name);
      // The first manifest wins, so a monorepo with a root package.json and a
      // service's own does not report the tool from both.
      if (existing === undefined) found.set(name, { version, source: manifest });
    }
  }
  return found;
}

/**
 * The dependency names a manifest declares, as `{ name, version }` pairs.
 *
 * **A best-effort reader per ecosystem, and it says which.** A full parser per
 * ecosystem is a package of its own; what the probe needs is "does this manifest
 * declare this tool, and at what version", and each reader below answers that
 * for its format. A malformed manifest yields no pairs rather than a throw: a
 * probe that crashes on a repository it cannot read tells the API nothing, while
 * one that answers "detected: false" lets the screen say so.
 *
 * Exported because it is a pure function with one rule per ecosystem, and a rule
 * that can only be reached through a repository fixture is a rule nobody tests:
 * "this repository mentions no catalogued tool" passes for the same reason as
 * "the parser read everything correctly", which is not a test.
 */
/**
 * A JSON manifest as an object, or `null` when it is not one.
 *
 * **A malformed manifest is an outcome, not an exception.** The probe reads the
 * repository a customer owns; a `package.json` with a trailing comma is a real
 * file on a real disk, and crashing the dashboard over it tells the reader
 * nothing. `null` is read by the caller as "no declarations", which the site
 * doctor surfaces as such.
 */
function jsonObject(content: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** `package.json`'s own reader. */
function parsepackagejson(content: string, found: Map<string, string | null>): void {
  const record = jsonObject(content);
  if (record === null) return;
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const block = record[section];
    if (block === null || typeof block !== 'object') continue;
    for (const [name, version] of Object.entries(block as Record<string, unknown>)) {
      found.set(name, typeof version === 'string' ? version : null);
    }
  }
}

/** `requirements.txt`'s own reader. */
function parserequirementstxt(content: string, found: Map<string, string | null>): void {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    // A comment, an option line (`-r other.txt`), or a blank. Skipped rather
    // than parsed: a line that is not a requirement says nothing about a
    // dependency, and reading one as a package name would invent a tool.
    if (line === '' || line.startsWith('#') || line.startsWith('-')) continue;
    // Split at the first comparison operator rather than with a pattern whose
    // optional tail is a quantifier stack: `name==1.2`, `name >= 1.2` and a bare
    // `name` all fall out of one `search`, and a regex with two nested
    // quantifiers is the shape the lint rule exists to stop.
    const operator = line.search(/[=<>!~]/u);
    const name = (operator === -1 ? line : line.slice(0, operator)).trim();
    const version = operator === -1 ? null : line.slice(operator).trim();
    if (name !== '') found.set(name, version);
  }
}

/** `pyproject.toml`'s own reader. */
function parsepyprojecttoml(content: string, found: Map<string, string | null>): void {
  // PEP 621 and Poetry spellings both appear as `name = "^1.2"` under a
  // dependencies table, and PEP 621 also allows a bare requirement string
  // (`"semgrep>=1.97"`) in an array. Each spelling is read on its own terms
  // rather than by one pattern trying to be all three.
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const assignment = /^"?([A-Za-z0-9._-]+)"?\s*=\s*"([^"]+)"/u.exec(line);
    if (assignment) {
      found.set(assignment[1], assignment[2].replace(/^[\^~]\s*/u, ''));
      continue;
    }
    // A quoted requirement in an array: `"semgrep>=1.97"`. Split at the first
    // comparison operator, exactly as `requirements.txt` is split, because the
    // version specifier grammar is the same one.
    const quoted = /^"([A-Za-z0-9._-]+)([<>=!~].*)",?$/u.exec(line);
    if (quoted) found.set(quoted[1], quoted[2].trim());
  }
}

/** `go.mod`'s own reader. */
function parsegomod(content: string, found: Map<string, string | null>): void {
  // `m`, because a `require` block is a list of lines and `^` has to match each
  // one rather than only the start of the file.
  for (const match of content.matchAll(/^\s*([A-Za-z0-9._/-]+)\s+v([0-9][^\s]*)/gmu)) {
    // The module path's last segment is the name: `github.com/grafana/k6`
    // declares `k6`, which is the id the catalogue uses.
    found.set(match[1].split('/').pop() ?? match[1], match[2]);
  }
}

/** `Cargo.toml`'s own reader. */
function parseCargotoml(content: string, found: Map<string, string | null>): void {
  const section = /\[(?:dev-)?dependencies\]([\s\S]*?)(?:\n\[|$)/u.exec(content);
  if (section) {
    for (const match of section[1].matchAll(
      /^\s*([A-Za-z0-9_-]+)\s*=\s*(?:\{[^}]*version\s*=\s*"([^"]+)")/gmu,
    )) {
      found.set(match[1], match[2]);
    }
  }
}

/** `Gemfile`'s own reader. */
function parseGemfile(content: string, found: Map<string, string | null>): void {
  // A line at a time, because a Gemfile line is a statement and not a stream:
  // `gem 'brakeman'` declares a tool with no version and `gem 'rubocop',
  // '1.60.2'` declares one with it, and the version is read from the rest of
  // the *same line* rather than by scanning the file for the next quote — which
  // would report the next gem's name as this one's version.
  for (const raw of content.split('\n')) {
    const name = /^\s*gem\s+'([^']+)'/u.exec(raw);
    if (name === null) continue;
    const version = /^\s*,\s*'([^']+)'/u.exec(raw.slice(name[0].length));
    found.set(name[1], version?.[1] ?? null);
  }
}

/** `pom.xml`'s own reader. */
function parsepomxml(content: string, found: Map<string, string | null>): void {
  for (const match of content.matchAll(/<artifactId>([^<]+)<\/artifactId>/gu)) {
    found.set(match[1], null);
  }
}

/**
 * One reader per manifest kind, keyed by the filename it reads.
 *
 * **A table rather than a chain of `endsWith`**, because the chain grew past the
 * repository's complexity ceiling the moment the seventh ecosystem went in and
 * a table says the same thing without it: the filename is the key and the reader
 * is the value. Adding a format is adding a row, and a reader that is never
 * reached is a row nobody wrote rather than a branch nobody took.
 */
const MANIFEST_READERS: ReadonlyMap<
  string,
  (content: string, found: Map<string, string | null>) => void
> = new Map([
  ['package.json', parsepackagejson],
  ['requirements.txt', parserequirementstxt],
  ['pyproject.toml', parsepyprojecttoml],
  ['go.mod', parsegomod],
  ['Cargo.toml', parseCargotoml],
  ['Gemfile', parseGemfile],
  ['pom.xml', parsepomxml],
]);

/**
 * The dependency names a manifest declares, as `{ name, version }` pairs.
 *
 * **A best-effort reader per ecosystem, and it says which.** A full parser per
 * ecosystem is a package of its own; what the probe needs is "does this manifest
 * declare this tool, and at what version", and each reader answers that for its
 * format. A malformed manifest yields no pairs rather than a throw: a probe that
 * crashes on a repository it cannot read tells the API nothing, while one that
 * answers "detected: false" lets the screen say so.
 *
 * Exported because each reader is a pure function with one rule per ecosystem,
 * and a rule that can only be reached through a repository fixture is a rule
 * nobody tests: "this repository mentions no catalogued tool" passes for the same
 * reason as "the parser read everything correctly", which is not a test.
 */
export function parseManifest(path: string, content: string): ReadonlyMap<string, string | null> {
  const found = new Map<string, string | null>();
  for (const [key, reader] of MANIFEST_READERS) {
    if (path.endsWith(key)) reader(content, found);
  }
  return found;
}

/**
 * Probe the repository for every tool in the catalogue.
 *
 * **A path that matched is stronger evidence than a dependency line**, so the
 * path is reported when one exists: a config file proves the tool is wired in,
 * while a dependency only proves it was installed.
 */
export async function probeToolchain(
  view: RepositoryView,
  env: ToolchainEnv = {},
): Promise<readonly ToolchainDetection[]> {
  const [paths, declarations] = await Promise.all([view.paths(), readManifestDeclarations(view)]);
  const detections: ToolchainDetection[] = [];
  for (const tool of QA_TOOLS_REGISTRY) {
    const matchedPath = paths.find((path) =>
      tool.detectPatterns.some((pattern) => path.includes(pattern)),
    );
    if (matchedPath !== undefined) {
      detections.push({
        toolId: tool.id,
        detected: true,
        evidence: matchedPath,
        version: versionFor(tool.id, declarations, env),
      });
      continue;
    }
    const matchedDependency = tool.dependencyNames.find((name) => declarations.has(name));
    if (matchedDependency !== undefined) {
      const declaration = declarations.get(matchedDependency);
      detections.push({
        toolId: tool.id,
        detected: true,
        evidence: `${declaration?.source ?? 'manifest'} → ${matchedDependency}`,
        version: versionFor(tool.id, declarations, env) ?? declaration?.version ?? null,
      });
      continue;
    }
    const override = env.versions?.[tool.id];
    detections.push({
      toolId: tool.id,
      detected: override !== undefined,
      // An override the repository cannot see: the evidence says so, so a reader
      // can tell an installed tool from an environment's claim about one.
      evidence: override === undefined ? null : `environment → ${tool.id}@${override}`,
      version: override ?? null,
    });
  }
  return detections;
}

/**
 * The version the manifest states for a tool, when the tool is declared by name.
 *
 * A tool is often declared under a different name than its catalogue id —
 * `@playwright/test` for `playwright` — so this looks the names up rather than
 * assuming the id is the package name.
 */
function versionFor(
  toolId: string,
  declarations: ReadonlyMap<string, { version: string | null }>,
  env: ToolchainEnv,
): string | null {
  const override = env.versions?.[toolId];
  if (override !== undefined) return override;
  const tool = QA_TOOLS_REGISTRY.find((candidate) => candidate.id === toolId);
  for (const name of tool?.dependencyNames ?? []) {
    const declaration = declarations.get(name);
    if (declaration?.version !== null && declaration?.version !== undefined) {
      return declaration.version;
    }
  }
  return null;
}
