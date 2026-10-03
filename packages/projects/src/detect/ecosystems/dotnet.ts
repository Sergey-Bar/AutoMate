import { allEvidenceFor } from '../manifest.js';
import { categoryForScriptName, type EcosystemDetector } from '../detector.js';
import type { ArtifactGlob, CommandCandidate, FrameworkSignal } from '../types.js';

const DOTNET_FRAMEWORKS: ReadonlyArray<readonly [string, FrameworkSignal['category']]> = [
  ['xunit', 'unit'],
  ['nunit', 'unit'],
  ['mstest', 'unit'],
  ['microsoft.net.test.sdk', 'unit'],
  ['microsoft.playwright', 'e2e'],
  ['coverlet.collector', 'unit'],
  ['nettest', 'integration'],
];

const DOTNET_ARTIFACTS: readonly ArtifactGlob[] = [
  { glob: '**/TestResults/*.trx', format: 'junit-xml', category: 'unit' },
];

/** Coverage is not a result: `canonical_run_results` has no row for a percentage. */
const DOTNET_COVERAGE_GLOBS = [{ glob: '**/coverage.cobertura.xml', format: 'cobertura' }] as const;

const DOTNET_COVERAGE_FORMATS = ['cobertura', 'lcov'] as const;

/**
 * `*.csproj` and `*.sln`, at any depth.
 *
 * A .NET repository is almost never a single project at the root, so the detector
 * lists rather than guessing a filename — and `**\*.csproj` is the shape the
 * workspace walk produces on Windows and the only one worth matching, since the
 * globs themselves are POSIX.
 */
function dotnetProjectFiles(paths: readonly string[]): string[] {
  return paths.filter((file) => file.endsWith('.csproj'));
}

/**
 * Restores the manifest's own spelling on an evidence line.
 *
 * The evidence string is quoted text an operator is going to look at, and quoting
 * `<PackageReference Include="NUnit" />` as `nunit` would not be that text. Only the
 * matched substring is rewritten, so the rest of the line is untouched.
 */
function restoreCase(line: string, needle: string, canonical: string): string {
  return line.replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu'), canonical);
}

export const detectDotnet: EcosystemDetector = async ({ paths, read }) => {
  const projectFiles = dotnetProjectFiles(paths);
  if (projectFiles.length === 0) return null;

  const texts = new Map<string, string>();
  for (const file of projectFiles) {
    const body = await read(file);
    if (body !== null) texts.set(file, body);
  }
  if (texts.size === 0) return null;

  // **Case-insensitively.** NuGet package ids are PascalCase — `NUnit`, `xunit`,
  // `Moq` — and the framework names in this table are lowercase because they are
  // spelled lowercase in every other ecosystem's manifest. A case-sensitive search
  // therefore matched `xunit` and missed `NUnit`, so every .NET project written by
  // a .NET developer was reported as having no test framework at all.
  const frameworks: FrameworkSignal[] = [];
  for (const [name, category] of DOTNET_FRAMEWORKS) {
    const needle = name.toLowerCase();
    const found = [...texts]
      .flatMap(([file, body]) => allEvidenceFor(file, body, [needle], true))
      .map((line) => restoreCase(line, needle, name));
    if (found.length > 0) frameworks.push({ name, category, evidence: found[0] as string });
  }

  return {
    ecosystem: 'dotnet',
    language: 'C#',
    packageManager: 'dotnet',
    frameworks,
    candidateCommands: dotnetCommands(projectFiles),
    artifactGlobs: [...DOTNET_ARTIFACTS],
    coverageGlobs: [...DOTNET_COVERAGE_GLOBS],
    coverageFormats: [...DOTNET_COVERAGE_FORMATS],
    confidence: frameworks.length > 0 ? 0.85 : 0.6,
  };
};

/**
 * `dotnet test` from the solution when one exists.
 *
 * `dotnet test` with no argument searches the current directory for a project or
 * solution, which in a repository whose projects are one level down finds
 * nothing and exits 0 — a green run that executed no test, which is the exact
 * failure mode the score would then report as a passing category.
 */
function dotnetCommands(projectFiles: readonly string[]): CommandCandidate[] {
  return [
    {
      id: 'dotnet.test',
      argv: ['dotnet', 'test'],
      label: 'dotnet test',
      category: categoryForScriptName('test'),
      // The first `.csproj` the walk found, not the glob that found it: an
      // evidence string a screen cannot open is not evidence.
      evidence: projectFiles[0] ?? '*.csproj',
      confidence: 0.7,
    },
  ];
}
