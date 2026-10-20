import {
  QA_CAPABILITIES,
  type CapabilityCoverage,
  type DetectedTool,
  type QaCapability,
  type RepoScan,
  type RepoTool,
  type ToolboxEntry,
} from '@automate/shared-contracts';
import { objectField, readJson } from '../detect/manifest.js';
import type { RepositoryView } from '../detect/repository-view.js';
import { TOOL_CATALOG, type CatalogTool } from './catalog.js';
import { scanReports } from './reports.js';
import { scanTools } from './tools.js';

/**
 * How much each capability counts toward the maturity number.
 *
 * Unit and end-to-end tests are the floor of a QA practice, so they weigh most; mutation,
 * contract and visual testing are what a mature practice adds, so their absence costs
 * least. The weights are a judgement and are written down here, in one place, so that a
 * reader who disagrees can find the number they disagree with.
 */
export const CAPABILITY_WEIGHTS: Readonly<Record<QaCapability, number>> = {
  unit: 3,
  integration: 2,
  e2e: 3,
  coverage: 2,
  'static-analysis': 2,
  types: 2,
  formatting: 1,
  sast: 2,
  secrets: 2,
  dependencies: 2,
  performance: 1.5,
  accessibility: 1.5,
  mutation: 1,
  contract: 1,
  visual: 1,
  ci: 2,
  api: 1.5,
  dast: 1,
  /*
   * Zero, and therefore never recommended: a web service without a device lab is not a
   * less mature practice, and a test-management system is a team's choice of process. Both
   * still show what the scan found, and both stay out of the maturity number.
   */
  mobile: 0,
  'test-management': 0,
};

const ECOSYSTEM_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\/)package\.json$/u, 'node'],
  [/(^|\/)(pyproject\.toml|requirements[^/]*\.txt|setup\.py)$/u, 'python'],
  [/(^|\/)go\.mod$/u, 'go'],
  [/(^|\/)Cargo\.toml$/u, 'rust'],
  [/(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/u, 'java'],
  [/\.(csproj|fsproj|sln)$/u, 'dotnet'],
  [/(^|\/)Gemfile$/u, 'ruby'],
  [/(^|\/)composer\.json$/u, 'php'],
  [/(^|\/)Package\.swift$|\.xcodeproj\//u, 'swift'],
];

const TEST_FILE =
  /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$|Tests?\.(java|cs|kt)$|_spec\.rb$/u;
const SOURCE_FILE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|cs|rb|php|kt|swift)$/u;

/**
 * Reads a repository and reports every tool, report and QA capability in it.
 *
 * Read-only, like the detector: nothing here installs or executes anything. Running a
 * tool is `run.start`, which re-resolves the id against a fresh scan on the server.
 */
export async function scanRepository(view: RepositoryView, now = new Date()): Promise<RepoScan> {
  const paths = await view.paths();
  const read = (path: string): Promise<string | null> => view.read(path);
  const [tools, reports, dependencies] = await Promise.all([
    scanTools(paths, read),
    scanReports(paths, read),
    collectDependencies(paths, read),
  ]);
  const ecosystems = ECOSYSTEM_MARKERS.filter(([marker]) =>
    paths.some((path) => marker.test(path)),
  ).map(([, name]) => name);
  const detected = detectTools(paths, dependencies);
  const capabilities = capabilityCoverage(detected, tools);
  const testFiles = paths.filter((path) => TEST_FILE.test(path)).length;
  return {
    scannedAt: now.toISOString(),
    ecosystems,
    manifests: paths.filter((path) => /(^|\/)package\.json$|(^|\/)pyproject\.toml$/u.test(path))
      .length,
    testFiles,
    sourceFiles: paths.filter((path) => SOURCE_FILE.test(path)).length - testFiles,
    tools,
    reports,
    detected,
    capabilities,
    maturity: maturity(capabilities),
    toolbox: toolbox(ecosystems, detected, capabilities),
  };
}

/** Dependency name → the manifest that declared it first, for the evidence line. */
async function collectDependencies(
  paths: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const add = (name: string, source: string): void => {
    const key = name.toLowerCase();
    if (!found.has(key)) found.set(key, source);
  };
  for (const path of paths) {
    const reader = MANIFEST_READERS.find(([pattern]) => pattern.test(path))?.[1];
    if (reader !== undefined) for (const name of reader(await read(path))) add(name, path);
  }
  return found;
}

/** The dependency names a `package.json` declares, in every dependency group. */
function packageDependencies(text: string | null): string[] {
  const manifest = readJson(text);
  return ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap((group) =>
    Object.keys(objectField(manifest, group) ?? {}),
  );
}

/** Every capture of group 1 of `pattern` in `text`. */
function captures(text: string | null, pattern: RegExp): string[] {
  if (text === null) return [];
  return [...text.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

/**
 * Dependency names from every manifest the scan reads: npm, Python, and the JVM, .NET, Ruby
 * and PHP manifests read as text.
 *
 * **Names, not a build.** A Maven artifactId, a Gradle `group:artifact` coordinate or
 * plugin id, a NuGet `PackageReference`, a `gem`, a Composer package. Resolving a
 * build file properly needs the build tool; the scan only needs to know that
 * `junit-jupiter` is named, which a regular expression answers without executing
 * anything the repository wrote.
 */
const MANIFEST_READERS: ReadonlyArray<readonly [RegExp, (text: string | null) => string[]]> = [
  [/(^|\/)package\.json$/u, packageDependencies],
  [/(^|\/)(requirements[^/]*\.txt|pyproject\.toml)$/u, pythonRequirements],
  [/(^|\/)pom\.xml$/u, (text) => captures(text, /<artifactId>\s*([\w.-]+)\s*<\/artifactId>/gu)],
  [
    /(^|\/)build\.gradle(\.kts)?$/u,
    (text) => [
      ...captures(text, /["'][\w.-]+:([\w.-]+)[:"']/gu),
      ...captures(text, /\bid\s*\(?\s*["']([\w.-]+)["']/gu),
      ...captures(text, /^\s*([a-z][\w-]*)\s*$/gmu).filter((name) => GRADLE_CORE_PLUGINS.has(name)),
    ],
  ],
  [/\.(csproj|fsproj)$/u, (text) => captures(text, /<PackageReference\s+Include="([\w.-]+)"/gu)],
  [/(^|\/)Gemfile$/u, (text) => captures(text, /^\s*gem\s+["']([\w-]+)["']/gmu)],
  [
    /(^|\/)composer\.json$/u,
    (text) => {
      const manifest = readJson(text);
      return ['require', 'require-dev'].flatMap((group) =>
        Object.keys(objectField(manifest, group) ?? {}),
      );
    },
  ],
];

/** Gradle's own plugins, applied by bare name inside a `plugins { }` block. */
const GRADLE_CORE_PLUGINS = new Set(['jacoco', 'checkstyle', 'pmd']);

/** Leading requirement names in a requirements file or quoted in a `pyproject.toml`. */
function pythonRequirements(text: string | null): string[] {
  if (text === null) return [];
  const names: string[] = [];
  for (const match of text.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*(?:[<>=~!;[]|$)/gmu)) {
    if (match[1] !== undefined) names.push(match[1]);
  }
  for (const match of text.matchAll(/["']([A-Za-z0-9][A-Za-z0-9_.-]*)\s*(?:[<>=~!;[]|["'])/gu)) {
    if (match[1] !== undefined) names.push(match[1]);
  }
  return names;
}

function detectTools(paths: readonly string[], dependencies: Map<string, string>): DetectedTool[] {
  const detected: DetectedTool[] = [];
  for (const tool of TOOL_CATALOG) {
    const evidence = evidenceFor(tool, paths, dependencies);
    if (evidence !== null) {
      detected.push({ id: tool.id, name: tool.name, capability: tool.capability, evidence });
    }
  }
  return detected;
}

function evidenceFor(
  tool: CatalogTool,
  paths: readonly string[],
  dependencies: Map<string, string>,
): string | null {
  for (const name of tool.dependencies ?? []) {
    const source = dependencies.get(name.toLowerCase());
    if (source !== undefined) return `${name} in ${source}`;
  }
  for (const pattern of tool.files ?? []) {
    const path = paths.find((candidate) => pattern.test(candidate));
    if (path !== undefined) return path;
  }
  return null;
}

function capabilityCoverage(detected: DetectedTool[], tools: RepoTool[]): CapabilityCoverage[] {
  return QA_CAPABILITIES.map((capability) => {
    const providers = [
      ...detected.filter((tool) => tool.capability === capability).map((tool) => tool.name),
      ...tools.filter((tool) => tool.kind === capability).map((tool) => tool.label),
    ];
    const unique = [...new Set(providers)].slice(0, 12);
    return {
      capability,
      covered: unique.length > 0,
      providers: unique,
      weight: CAPABILITY_WEIGHTS[capability],
    };
  });
}

function maturity(capabilities: CapabilityCoverage[]): number {
  const total = capabilities.reduce((sum, entry) => sum + entry.weight, 0);
  const covered = capabilities
    .filter((entry) => entry.covered)
    .reduce((sum, entry) => sum + entry.weight, 0);
  return total === 0 ? 0 : Math.round((covered / total) * 100);
}

function relevant(tool: CatalogTool, ecosystems: readonly string[]): boolean {
  if (tool.ecosystems.includes('any')) return true;
  return tool.ecosystems.some((ecosystem) => ecosystems.includes(ecosystem));
}

function priorityFor(capability: QaCapability): ToolboxEntry['priority'] {
  const weight = CAPABILITY_WEIGHTS[capability];
  if (weight >= 2) return 'high';
  if (weight >= 1.5) return 'medium';
  return 'low';
}

/**
 * Every catalogue tool that fits the repository, with what to do about it.
 *
 * **One recommendation per missing capability, and only a free or freemium one.** Recommending all three load-testing
 * tools for a repository with none says "pick one" without saying which, and the point
 * of a recommendation is to have picked. The others are listed as `available`.
 */
function toolbox(
  ecosystems: readonly string[],
  detected: DetectedTool[],
  capabilities: CapabilityCoverage[],
): ToolboxEntry[] {
  const inUse = new Map(detected.map((tool) => [tool.id, tool.evidence]));
  const uncovered = new Set(capabilities.filter((c) => !c.covered).map((c) => c.capability));
  const recommended = new Set<QaCapability>();
  const entries: ToolboxEntry[] = [];
  for (const tool of TOOL_CATALOG.filter((candidate) => relevant(candidate, ecosystems))) {
    const evidence = inUse.get(tool.id);
    const recommend = shouldRecommend(tool, evidence, uncovered, recommended);
    if (recommend) recommended.add(tool.capability);
    entries.push(entryFor(tool, evidence, recommend, uncovered.has(tool.capability)));
  }
  return entries;
}

function shouldRecommend(
  tool: CatalogTool,
  evidence: string | undefined,
  uncovered: ReadonlySet<QaCapability>,
  recommended: ReadonlySet<QaCapability>,
): boolean {
  return (
    evidence === undefined &&
    tool.preferred === true &&
    // A recommendation is adoptable today: never a paid tool, and never a capability the
    // maturity number does not count.
    tool.pricing !== 'paid' &&
    CAPABILITY_WEIGHTS[tool.capability] > 0 &&
    uncovered.has(tool.capability) &&
    !recommended.has(tool.capability)
  );
}

function entryFor(
  tool: CatalogTool,
  evidence: string | undefined,
  recommend: boolean,
  uncovered: boolean,
): ToolboxEntry {
  return {
    id: tool.id,
    name: tool.name,
    capability: tool.capability,
    description: tool.description,
    ecosystems: [...tool.ecosystems],
    status: evidence !== undefined ? 'in-use' : recommend ? 'recommended' : 'available',
    priority: priorityFor(tool.capability),
    reason: reasonFor(tool.capability, evidence, recommend, uncovered),
    setup: tool.setup,
    docsUrl: tool.docsUrl,
    pricing: tool.pricing,
    ...(tool.vendorUrl === undefined ? {} : { vendorUrl: tool.vendorUrl }),
  };
}

function reasonFor(
  capability: QaCapability,
  evidence: string | undefined,
  recommend: boolean,
  uncovered: boolean,
): string {
  if (evidence !== undefined) return `Found: ${evidence}`;
  if (recommend) return `Nothing in this repository covers ${capability}.`;
  if (uncovered) return `An alternative for ${capability}.`;
  return `${capability} is already covered by another tool.`;
}
