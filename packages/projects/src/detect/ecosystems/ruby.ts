import { evidenceFor, rubyDependencyNames } from '../manifest.js';
import { categoryForScriptName, type EcosystemDetector } from '../detector.js';
import type { ArtifactGlob, CommandCandidate, FrameworkSignal } from '../types.js';

const RUBY_FRAMEWORKS: ReadonlyArray<readonly [string, FrameworkSignal['category']]> = [
  ['rspec', 'unit'],
  ['minitest', 'unit'],
  ['cucumber', 'integration'],
  ['capybara', 'e2e'],
  ['selenium-webdriver', 'e2e'],
  ['simplecov', 'unit'],
  ['k6', 'performance'],
  ['brakeman', 'security'],
];

const RUBY_ARTIFACTS: readonly ArtifactGlob[] = [
  { glob: '**/rspec*.xml', format: 'junit-xml', category: 'unit' },
  { glob: '**/test-results/*.xml', format: 'junit-xml', category: 'unit' },
];

/** SimpleCov writes `coverage/.resultset.json`, which is its own format. */
const RUBY_COVERAGE_GLOBS = [
  { glob: 'coverage/.resultset.json', format: 'simplecov' },
  { glob: 'coverage/.last_run.json', format: 'simplecov' },
] as const;

const RUBY_COVERAGE_FORMATS = ['simplecov', 'lcov'] as const;

function gemspecFiles(paths: readonly string[]): string[] {
  return paths.filter((file) => file.endsWith('.gemspec'));
}

export const detectRuby: EcosystemDetector = async ({ paths, read }) => {
  // **Every** Ruby manifest, not the first one.
  //
  // Dogfooded against `rack/rack`, which ships both a `Gemfile` and a
  // `rack.gemspec`, and was reported with **zero** frameworks twice: first because
  // the gemspec's `add_development_dependency` lines were invisible to the reader,
  // and then — with that fixed — because the reader still looked only at the
  // `Gemfile`, which says nothing about the test framework and instead does
  // `gemspec` to pull the real declarations in from the `.gemspec`.
  //
  // Reading one of them is reading at most half the answer, and the half Rack uses
  // is the empty one. A repository that declares its tests in the gemspec, in the
  // Gemfile, or in both is ordinary, so the detector reads all of them.
  const files = ['Gemfile', ...gemspecFiles(paths)].filter((file) => paths.includes(file));
  if (files.length === 0) return null;

  const texts = new Map<string, string>();
  for (const file of files) {
    const body = await read(file);
    if (body !== null) texts.set(file, body);
  }
  if (texts.size === 0) return null;

  const names = new Set<string>();
  for (const body of texts.values()) {
    for (const name of rubyDependencyNames(body)) names.add(name);
  }
  const frameworks = RUBY_FRAMEWORKS.filter(([name]) => names.has(name)).map(
    ([name, category]) => ({
      name,
      category,
      // Cited from whichever manifest actually names it. Pointing at the `Gemfile`
      // when the declaration is in the gemspec would send an operator to open a
      // file that does not mention their test framework at all.
      evidence: citeFrom(texts, name),
    }),
  );
  const hasRakefile = paths.some((file) => file === 'Rakefile' || file.endsWith('/Rakefile'));

  return {
    ecosystem: 'ruby',
    language: 'Ruby',
    // Bundler, whenever there is a `Gemfile` at all. The previous rule keyed on
    // `Gemfile.lock`, which answers a *different* question: a lockfile says the
    // versions are pinned, not that bundler is in use. `rack/rack` is a library and
    // checks in no lockfile, so it was reported as `ruby` while the commands below
    // it said `bundle exec rake test` — a screen showing "package manager: ruby"
    // beside a bundler command contradicts itself, and the operator cannot tell
    // which of the two the runner will honour.
    packageManager: paths.includes('Gemfile') ? 'bundler' : 'ruby',
    frameworks,
    candidateCommands: rubyCommands(names, hasRakefile, files[0] as string),
    artifactGlobs: [...RUBY_ARTIFACTS],
    coverageGlobs: [...RUBY_COVERAGE_GLOBS],
    coverageFormats: [...RUBY_COVERAGE_FORMATS],
    confidence: frameworks.length > 0 || hasRakefile ? 0.85 : 0.55,
  };
};

/** The manifest that names `needle`, cited from the file that actually names it. */
function citeFrom(texts: ReadonlyMap<string, string>, needle: string): string {
  for (const [file, body] of texts) {
    const cited = evidenceFor(file, body, needle);
    if (cited !== file) return cited;
  }
  return [...texts.keys()][0] ?? 'Gemfile';
}

/**
 * `bundle exec rspec` when RSpec is declared, `rake` when a Rakefile exists,
 * `rake test` otherwise.
 *
 * Bundled through `bundle exec` because an un-bundled Ruby process resolves gems
 * from the system, and a system that happens to have a different RSpec version
 * produces results that are not this repository's.
 */
function rubyCommands(
  names: ReadonlySet<string>,
  hasRakefile: boolean,
  manifest: string,
): CommandCandidate[] {
  const candidates: Array<readonly [string, string[], number]> = [];
  if (names.has('rspec')) candidates.push(['ruby.rspec', ['bundle', 'exec', 'rspec'], 0.85]);
  if (hasRakefile) candidates.push(['ruby.rake', ['bundle', 'exec', 'rake'], 0.7]);
  candidates.push(['ruby.rake.test', ['bundle', 'exec', 'rake', 'test'], 0.5]);

  return candidates
    .map(
      ([id, argv, confidence]): CommandCandidate => ({
        id,
        argv: [...argv],
        label: argv.join(' '),
        category: categoryForScriptName('test'),
        evidence: manifest,
        confidence,
      }),
    )
    .sort((left, right) => right.confidence - left.confidence);
}
