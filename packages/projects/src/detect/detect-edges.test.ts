import { describe, expect, it } from 'vitest';

import { detectProject } from './index.js';
import { literalView } from './repository-view.js';
import {
  distributionName,
  readJson,
  rubyDependencyNames,
  tomlAllStringArrays,
  xmlArtifactIds,
} from './manifest.js';

/**
 * The detectors' second path.
 *
 * `ecosystems.test.ts` gives each ecosystem **one** fixture — the shape that makes
 * it recognised. That proves the happy path and nothing else, and every branch below
 * is a branch a detector can take that the happy path does not: a second manifest,
 * a lockfile naming a different package manager, a missing optional file. They are
 * the branches a customer hits first, because a customer's repository is not the
 * minimal one that was written to demonstrate the detector.
 */

const detect = async (
  files: Record<string, string>,
): Promise<Awaited<ReturnType<typeof detectProject>>> => detectProject(literalView(files));

describe('the manifest readers', () => {
  it('takes a distribution name from a specifier, extras and markers and all', () => {
    // The whole reason a `pyproject.toml` with a perfectly ordinary test extra was
    // once reported as having no test framework.
    for (const requirement of [
      'pytest>=7.4',
      'pytest[dev]==7.4',
      "pytest ; python_version>'3.8'",
      '  PyTest ',
    ]) {
      expect(distributionName(requirement), requirement).toBe('pytest');
    }
    expect(distributionName('==7.4')).toBe('');
  });

  it('reads every named array in a table of groups, not just `dependencies`', () => {
    expect(tomlAllStringArrays('dev = ["pytest"]\ndocs = ["mkdocs"]')).toEqual([
      'pytest',
      'mkdocs',
    ]);
  });

  it('reads a Ruby Gemfile, a gemspec, and a versioned pin', () => {
    expect(
      rubyDependencyNames(
        "source 'https://rubygems.org'\ngem 'rspec', '~> 3.13'\n  gem \"simplecov\"\ngem 'rack', '>= 2'\n",
      ),
    ).toEqual(new Set(['rspec', 'simplecov', 'rack']));
  });

  it('reads artifact ids and package names from Maven XML', () => {
    expect(
      xmlArtifactIds('<artifactId>junit-jupiter</artifactId><package>org.junit</package>'),
    ).toEqual(new Set(['junit-jupiter', 'org.junit']));
  });

  it('returns null for JSON that is not an object, rather than throwing', () => {
    // A manifest is customer input. `JSON.parse` raising has no way to say "I could
    // not read this", so the exception surfaces as a 500 from `project.add`.
    expect(readJson('{ truncated')).toBeNull();
    expect(readJson('[]')).toBeNull();
    expect(readJson('null')).toBeNull();
    expect(readJson(null)).toBeNull();
    expect(readJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('a second manifest in the same repository', () => {
  it('prefers Gradle when there is no POM, and proposes the wrapper', async () => {
    const result = await detect({ 'build.gradle.kts': 'plugins { id("junit") }\n' });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.ecosystem).toBe('java');
    expect(result.packageManager).toBe('gradle');
    expect(result.candidateCommands.map((command) => command.id)).toContain('java.gradle');
  });

  it('proposes both when a Maven project also has a Gradle build', async () => {
    // Two build systems in one repository is a real state — a Maven project with a
    // Gradle module — and proposing only one would hide half the evidence.
    const result = await detect({
      'pom.xml': '<project><artifactId>junit</artifactId></project>',
      'build.gradle': '',
    });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    // Both at the same confidence, so the documented tie-break — id, ascending —
    // decides. A fixed insertion order would be a second ranking authority.
    expect(result.candidateCommands.map((command) => command.id)).toEqual([
      'java.gradle',
      'java.maven',
    ]);
  });

  it('reads a Python project that declares itself only in requirements.txt', async () => {
    const result = await detect({
      'requirements-dev.txt': 'pytest>=7.4\npytest-cov\nlocust\n',
      'setup.py': 'from setuptools import setup\n',
    });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.ecosystem).toBe('python');
    expect(result.frameworks.map((framework) => framework.name)).toEqual(
      expect.arrayContaining(['pytest', 'pytest-cov', 'locust']),
    );
  });

  it('reads a Python project from build-system.requires alone', async () => {
    const result = await detect({
      'pyproject.toml': '[build-system]\nrequires = ["hatchling"]\n',
    });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    // No test framework in the document at all, so the detector falls back to the
    // standard library — which every Python repository can run, and which is a far
    // better proposal than "I could not find anything".
    expect(result.candidateCommands.map((command) => command.id)).toEqual(['python.unittest']);
  });

  it('reads a .NET solution with no csproj beyond one nested project', async () => {
    const result = await detect({
      'Api.sln': 'Microsoft Visual Studio Solution File',
      'src/Api/Api.csproj':
        '<Project Sdk="Microsoft.NET.Sdk"><PackageReference Include="NUnit" /></Project>',
    });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.ecosystem).toBe('dotnet');
    expect(result.frameworks.map((framework) => framework.name)).toContain('nunit');
  });

  it('reads a Go module with a vendored package.json as Go', async () => {
    // A monorepo root, not a contradiction. `go` is ahead of `node` in the matrix
    // for exactly this case.
    const result = await detect({
      'go.mod': 'module example.com/svc\ngo 1.22\n',
      'web/package.json': '{"name":"ui","scripts":{"test":"vitest"}}',
    });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.ecosystem).toBe('go');
  });
});

describe('dogfooded against repositories nobody wrote a fixture for', () => {
  /**
   * Every assertion below is a **red-first test written after** the detector gave a
   * wrong answer on a real checkout. The repositories are named so a reader can
   * reproduce the original miss; the fixtures are reduced to the lines that carried
   * the answer, because a full copy of `rack/rack` is 186 files and the defect was
   * in four of them.
   */
  it('reads a gemspec that declares its framework with `add_development_dependency`', async () => {
    // **rack/rack, reported with zero frameworks.** The reader required a quote
    // immediately after `spec.add_`, so `s.add_development_dependency 'minitest'`
    // never matched — the word `development` sits in between. The score takes
    // `presence` from whether a suite completed a run, so this reads as *this
    // repository has no tests*, which is a claim about a repository that ships
    // thousands of them.
    const result = await detect({ 'rack.gemspec': GEMSPEC_WITH_MINITEST });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.frameworks.map((framework) => framework.name)).toContain('minitest');
  });

  it('reads both the Gemfile and the gemspec, because a Gemfile often names neither', async () => {
    // **rack/rack again, still zero after the first fix.** Rack's `Gemfile` says
    // `gemspec` and nothing else; every declaration lives in the `.gemspec`. A
    // reader that opens the first manifest it finds reads the empty half.
    const result = await detect({
      Gemfile: "source 'https://rubygems.org'\ngemspec\n",
      'rack.gemspec': GEMSPEC_WITH_MINITEST,
    });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.frameworks.map((framework) => framework.name)).toContain('minitest');
    // And the evidence names the file that actually declares it — pointing an
    // operator at the `Gemfile` sends them to a file with no minitest in it.
    const minitest = result.frameworks.find((framework) => framework.name === 'minitest');
    expect(minitest?.evidence).toContain('rack.gemspec');
  });

  it('proposes the wrapper a repository ships, not the one on the PATH', async () => {
    // **spring-projects/spring-petclinic**, which ships `mvnw`, `gradlew`, a
    // `pom.xml` and a `build.gradle`. Proposing bare `mvn` told the operator to
    // run whatever Maven their PATH happened to carry, which is a different build
    // tool from the one the repository pins.
    const result = await detect({
      'pom.xml': '<project/>',
      mvnw: '',
      gradlew: '',
      'build.gradle': '',
    });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.candidateCommands.map((command) => command.argv[0])).toEqual([
      './gradlew',
      './mvnw',
    ]);
  });

  it('proposes the bare tool when a repository ships no wrapper', async () => {
    const result = await detect({ 'pom.xml': '<project/>' });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.candidateCommands[0]?.argv[0]).toBe('mvn');
  });

  it('says the build system is ambiguous when a repository ships two build files', async () => {
    // Naming `maven` for a repository that also has `build.gradle` is a claim the
    // repository contradicts, and the command list below proposes both.
    const result = await detect({ 'pom.xml': '<project/>', 'build.gradle': '', gradlew: '' });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.packageManager).toBe('2 build files');
    expect(result.candidateCommands).toHaveLength(2);
  });

  it('calls a Ruby repository bundler-managed whenever it has a Gemfile', async () => {
    // **rack/rack, third finding.** It ships no `Gemfile.lock` — it is a library,
    // and libraries do not check in lockfiles — so the detector answered `ruby`
    // while proposing `bundle exec rake test`. A screen rendering "package manager:
    // ruby" beside a `bundle exec` command contradicts itself. Bundler works
    // perfectly well without a lockfile; the lockfile says the versions are pinned,
    // not that bundler is in use.
    const result = await detect({ Gemfile: 'gemspec\n', 'rack.gemspec': GEMSPEC_WITH_MINITEST });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.packageManager).toBe('bundler');
  });
});

/** Rack's gemspec, reduced to the four lines that carried the answer. */
const GEMSPEC_WITH_MINITEST = [
  "s.add_development_dependency 'minitest', '> 5'",
  "s.add_development_dependency 'minitest-global_expectations'",
  "s.add_development_dependency 'bundler'",
  "s.add_development_dependency 'rake'",
].join('\n');

describe('a package manager comes from the lockfile, not from a default', () => {
  it('reads bun, yarn and npm as well as pnpm', async () => {
    for (const [lockfile, manager] of [
      ['bun.lockb', 'bun'],
      ['yarn.lock', 'yarn'],
      ['package-lock.json', 'npm'],
      ['npm-shrinkwrap.json', 'npm'],
    ] as const) {
      const result = await detect({
        'package.json': '{"name":"a","scripts":{"test":"x"}}',
        [lockfile]: '',
      });
      expect(result.recognised).toBe(true);
      if (!result.recognised) return;
      expect(result.packageManager, lockfile).toBe(manager);
      expect(result.candidateCommands[0]?.argv[0], lockfile).toBe(manager);
    }
  });

  it('falls back to npm when there is no lockfile at all', async () => {
    const result = await detect({ 'package.json': '{"name":"a","scripts":{"test":"x"}}' });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.packageManager).toBe('npm');
  });

  it('reads uv and poetry before pip', async () => {
    const uv = await detect({
      'pyproject.toml': '[project]\nname="a"\n',
      'uv.lock': 'version = 1\n',
    });
    expect(uv.recognised).toBe(true);
    if (uv.recognised) expect(uv.packageManager).toBe('uv');

    const poetry = await detect({
      'pyproject.toml': '[tool.poetry]\nname="a"\n',
      'poetry.lock': '\n',
    });
    expect(poetry.recognised).toBe(true);
    if (poetry.recognised) expect(poetry.packageManager).toBe('poetry');
  });

  it('reads bundler for a Ruby project with a lockfile', async () => {
    const result = await detect({ Gemfile: "gem 'rspec'\n", 'Gemfile.lock': 'GEM\n' });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.packageManager).toBe('bundler');
  });
});

describe('a project with a manifest and nothing else still proposes something runnable', () => {
  it('proposes PHPUnit when composer.json declares no test script', async () => {
    const result = await detect({ 'composer.json': '{"require":{"phpunit/phpunit":"^11"}}' });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    // No declared script, so the binary — which reads the project's own
    // `phpunit.xml`, unlike a bare `phpunit` on the path.
    expect(result.candidateCommands.map((command) => command.id)).toEqual(['php.phpunit']);
  });

  it('proposes rspec over rake when both are available', async () => {
    const result = await detect({ Gemfile: "gem 'rspec'\n", Rakefile: 'task :spec\n' });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    // `bundle exec rspec` first: the un-bundled process resolves gems from the
    // system, and a system with a different rspec produces results that are not this
    // repository's.
    expect(result.candidateCommands[0]?.argv).toEqual(['bundle', 'exec', 'rspec']);
  });

  it('proposes a gemspec-only Ruby project with rake test', async () => {
    const result = await detect({ 'svc.gemspec': "spec.add_dependency 'rails'\n" });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    expect(result.candidateCommands.map((command) => command.id)).toContain('ruby.rake.test');
  });

  it('proposes nextest for a Rust project that asked for it', async () => {
    const result = await detect({
      'Cargo.toml': '[package]\nname="a"\n\n[dev-dependencies]\nnextest = "0.9"\n',
    });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    // Ranked by confidence, so `cargo test` (0.9) leads `nextest` (0.85) even
    // though the project asked for nextest by naming it. Both are proposed and the
    // override is one key away; a fixed order that ignored confidence would be a
    // second ranking authority.
    expect(result.candidateCommands.map((command) => command.id).sort()).toEqual([
      'rust.cargo-test',
      'rust.llvm-cov',
      'rust.nextest',
    ]);
  });

  it('proposes both the verdict and the coverage command for Go', async () => {
    const result = await detect({ 'go.mod': 'module example.com/svc\n' });
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    // `go test ./...` alone scores a repository as having no measured surface, which
    // is indistinguishable from one that genuinely has none.
    expect(result.candidateCommands.map((command) => command.id)).toEqual([
      'go.test',
      'go.test.cover',
    ]);
  });
});
