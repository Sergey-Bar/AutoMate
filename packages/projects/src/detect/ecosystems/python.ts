import { allEvidenceFor, tomlAllStringArrays, tomlSection, tomlStringArray } from '../manifest.js';
import { categoryForScriptName, type EcosystemDetector } from '../detector.js';
import type { ArtifactGlob, CommandCandidate, FrameworkSignal } from '../types.js';

const PYTHON_FRAMEWORKS: ReadonlyArray<readonly [string, FrameworkSignal['category']]> = [
  ['pytest', 'unit'],
  ['unittest', 'unit'],
  ['nose', 'unit'],
  ['playwright', 'e2e'],
  ['selenium', 'e2e'],
  ['locust', 'performance'],
  ['pytest-cov', 'unit'],
  ['bandit', 'security'],
];

const PYTHON_ARTIFACTS: readonly ArtifactGlob[] = [
  { glob: '**/junit*.xml', format: 'junit-xml', category: 'unit' },
  { glob: '**/pytest-report*.xml', format: 'junit-xml', category: 'integration' },
  { glob: '**/zap-report.xml', format: 'zap-xml', category: 'security' },
];

const PYTHON_COVERAGE_FORMATS = ['cobertura', 'lcov'] as const;

const PYTHON_MANIFESTS = ['pyproject.toml', 'setup.cfg', 'tox.ini', 'setup.py'] as const;

/** `requirements*.txt` and its variants, which the walk lists but the detector filters. */
function requirementFiles(paths: readonly string[]): string[] {
  return paths.filter((file) => /(?:^|\/)requirements[\w.-]*\.txt$/.test(file));
}

function isPythonManifest(file: string): boolean {
  return (
    (PYTHON_MANIFESTS as readonly string[]).includes(file) || requirementFiles([file]).length > 0
  );
}

/** Every declared Python manifest, read once, keyed by repo-relative path. */
async function readManifests(
  paths: readonly string[],
  read: (relativePath: string) => Promise<string | null>,
): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const file of paths) {
    if (!isPythonManifest(file)) continue;
    const body = await read(file);
    if (body !== null) texts.set(file, body);
  }
  return texts;
}

/**
 * Package names from `requirements*.txt`, one per line.
 *
 * Only the leading name is taken, so `pytest>=7.0`, `pytest[dev]==7.4` and
 * `pytest ; python_version>'3.8'` all read as `pytest`. Extras and markers are
 * packaging syntax, not part of the distribution's name.
 */
function namesFromRequirements(
  paths: readonly string[],
  texts: ReadonlyMap<string, string>,
): string[] {
  return requirementFiles(paths).flatMap((file) =>
    (texts.get(file) ?? '')
      .split(/\r?\n/)
      .map((line) => /^\s*([A-Za-z0-9._-]+)/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );
}

/**
 * Names from a `pyproject.toml`, across every table a dependency can hide in.
 *
 * A `pytest` in `[project.optional-dependencies]` is the same dependency as one
 * in `[dependency-groups]` or `[tool.poetry.group.dev.dependencies]`, and
 * collecting all of them is what finds a repository that splits its test extras
 * across three tables. The two group tables are read with `tomlAllStringArrays`
 * rather than `tomlStringArray(…, 'dependencies')` because they are keyed by
 * group name (`dev = [...]`), not by `dependencies`.
 */
function namesFromPyproject(body: string): string[] {
  const direct = ['project', 'tool.poetry', 'tool.poetry.group.dev'].flatMap((header) =>
    tomlStringArray(tomlSection(body, header), 'dependencies'),
  );
  const grouped = [
    'project.optional-dependencies',
    'dependency-groups',
    'tool.poetry.group.dev.dependencies',
  ].flatMap((header) => tomlAllStringArrays(tomlSection(body, header)));
  const build = tomlStringArray(tomlSection(body, 'build-system'), 'requires');
  return [...direct, ...grouped, ...build];
}

function allNames(paths: readonly string[], texts: ReadonlyMap<string, string>): string[] {
  const names = namesFromRequirements(paths, texts);
  for (const file of PYTHON_MANIFESTS) {
    names.push(...namesFromPyproject(texts.get(file) ?? ''));
  }
  return names.map((name) => name.toLowerCase());
}

/**
 * The evidence for a framework, as the manifest line that named it.
 *
 * Falls back to the first manifest's path when no line mentions the name — which
 * happens for `unittest`, since it is in the standard library and no manifest
 * declares it. `evidenceFor` in `manifest.ts` has the same fallback, and it is
 * the honest string for "this is what a Python repository does by default".
 */
function evidenceFor(texts: ReadonlyMap<string, string>, needle: string): string {
  for (const [file, body] of texts) {
    const found = allEvidenceFor(file, body, [needle])[0];
    if (found) return found;
  }
  return [...texts.keys()][0] ?? 'pyproject.toml';
}

/** `uv.lock` and `poetry.lock` are as binding as a Node lockfile; `requirements.txt` is not. */
function pythonPackageManager(paths: readonly string[]): string {
  if (paths.includes('uv.lock')) return 'uv';
  if (paths.includes('poetry.lock')) return 'poetry';
  if (paths.includes('Pipfile.lock')) return 'pipenv';
  return 'pip';
}

/**
 * `pytest` when a manifest names it, `unittest` otherwise.
 *
 * `unittest` is the floor rather than "nothing proposed": it is in the standard
 * library, so every Python repository can run it, and proposing a command the
 * operator cannot execute is worse than proposing a coarse one.
 */
function pythonCommands(
  paths: readonly string[],
  texts: ReadonlyMap<string, string>,
): CommandCandidate[] {
  const declared = allNames(paths, texts);
  const runner = declared.includes('pytest') ? 'pytest' : 'unittest';
  const argv =
    runner === 'pytest' ? ['python', '-m', 'pytest'] : ['python', '-m', 'unittest', 'discover'];
  return [
    {
      id: `python.${runner}`,
      argv,
      label: argv.join(' '),
      category: categoryForScriptName('test'),
      evidence: evidenceFor(texts, runner),
      confidence: runner === 'pytest' ? 0.85 : 0.5,
    },
  ];
}

export const detectPython: EcosystemDetector = async ({ paths, read }) => {
  if (!PYTHON_MANIFESTS.some((file) => paths.includes(file))) return null;

  const texts = await readManifests(paths, read);
  if (texts.size === 0) return null;
  const names = new Set(allNames(paths, texts));
  const frameworks = PYTHON_FRAMEWORKS.filter(([name]) => names.has(name)).map(
    ([name, category]) => ({
      name,
      category,
      evidence: evidenceFor(texts, name),
    }),
  );

  return {
    ecosystem: 'python',
    language: 'Python',
    packageManager: pythonPackageManager(paths),
    frameworks,
    candidateCommands: pythonCommands(paths, texts),
    artifactGlobs: [...PYTHON_ARTIFACTS],
    coverageGlobs: [],
    coverageFormats: [...PYTHON_COVERAGE_FORMATS],
    confidence: frameworks.length > 0 ? 0.9 : 0.6,
  };
};
