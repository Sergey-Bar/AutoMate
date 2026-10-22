import { describe, expect, it } from 'vitest';

import { detectProject, type DetectResult } from './index.js';
import type { RepositoryView } from './repository-view.js';

/**
 * Detector branches the happy-path fixtures do not reach: a manifest that is listed but
 * cannot be read (a permission error, a file removed mid-walk), a manifest with nothing in
 * it, and the fallbacks each detector takes when its evidence is thin.
 */

/** A view whose `paths` includes files `read` then refuses, as a racing checkout would. */
function view(files: Record<string, string>, unreadable: readonly string[] = []): RepositoryView {
  return {
    async paths() {
      return [...Object.keys(files), ...unreadable].sort();
    },
    async read(relativePath) {
      return files[relativePath] ?? null;
    },
  };
}

function recognised(result: DetectResult) {
  if (!result.recognised) throw new Error('expected the repository to be recognised');
  return result;
}

describe('a manifest that is listed but cannot be read', () => {
  it.each(['go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'Gemfile', 'pyproject.toml'])(
    'reports %s as unrecognised rather than crashing or inventing a profile',
    async (manifest) => {
      const result = await detectProject(view({}, [manifest]));
      expect(result.recognised).toBe(false);
    },
  );

  it('reports a .csproj nobody can read as unrecognised', async () => {
    expect((await detectProject(view({}, ['app/app.csproj']))).recognised).toBe(false);
  });

  it('reports composer.json that is not JSON as unrecognised', async () => {
    expect((await detectProject(view({ 'composer.json': '{ nope' }))).recognised).toBe(false);
  });

  it('still uses the manifests it can read when a sibling cannot be', async () => {
    const result = recognised(
      await detectProject(
        view({ 'build.gradle': 'testImplementation "org.junit.jupiter:junit-jupiter"' }, [
          'pom.xml',
        ]),
      ),
    );
    expect(result.ecosystem).toBe('java');
    expect(result.candidateCommands.map((c) => c.id)).toEqual(['java.gradle']);
  });
});

describe('go', () => {
  it('proposes the standard runner for a go.mod with no test dependency', async () => {
    const result = recognised(await detectProject(view({ 'go.mod': 'module example.test/x\n' })));
    expect(result.frameworks.map((f) => f.name)).toEqual(['testing']);
    expect(result.frameworks[0]?.evidence).toBe('go.mod:1 module example.test/x');
  });

  it('adds a framework the module requires, after the standard runner', async () => {
    const result = recognised(
      await detectProject(
        view({ 'go.mod': 'module x\nrequire github.com/stretchr/testify v1.9.0\n' }),
      ),
    );
    expect(result.frameworks.map((f) => f.name)).toEqual(['testing', 'testify']);
  });
});

describe('rust', () => {
  it('proposes libtest for a Cargo.toml with no test dependency, citing the package table', async () => {
    const result = recognised(
      await detectProject(view({ 'Cargo.toml': '[package]\nname = "x"\n' })),
    );
    expect(result.frameworks).toEqual([
      { name: 'libtest', category: 'unit', evidence: 'Cargo.toml:1 [package]' },
    ]);
    expect(result.candidateCommands.some((c) => c.argv.includes('nextest'))).toBe(false);
  });

  it('proposes nextest only when Cargo.toml asks for it', async () => {
    const result = recognised(
      await detectProject(
        view({
          'Cargo.toml': '[package]\nname = "x"\n[dev-dependencies]\nproptest = "1"\n# nextest\n',
        }),
      ),
    );
    expect(result.frameworks.map((f) => f.name)).toContain('proptest');
    expect(result.candidateCommands.some((c) => c.argv.includes('nextest'))).toBe(true);
  });
});

describe('java', () => {
  it('names a single build system, and says how many when there are several', async () => {
    const maven = recognised(await detectProject(view({ 'pom.xml': '<project/>' })));
    expect(maven.candidateCommands.map((c) => c.id)).toEqual(['java.maven']);
    expect(maven.candidateCommands[0]?.argv).toEqual(['mvn', 'verify']);

    const both = recognised(
      await detectProject(
        view({ 'pom.xml': '<project/>', 'build.gradle.kts': '', gradlew: '', mvnw: '' }),
      ),
    );
    expect(both.candidateCommands.map((c) => c.argv[0]).sort()).toEqual(['./gradlew', './mvnw']);
    const gradle = both.candidateCommands.find((c) => c.id === 'java.gradle');
    expect(gradle?.evidence).toBe('build.gradle.kts');
  });

  it('cites the file that names a framework, and no framework when none is named', async () => {
    const result = recognised(
      await detectProject(
        view({
          'pom.xml': '<project/>',
          'build.gradle': 'dependencies {\n  testImplementation "org.testng:testng"\n}',
        }),
      ),
    );
    const testng = result.frameworks.find((f) => f.name === 'testng');
    expect(testng?.evidence).toBe('build.gradle:2 testImplementation "org.testng:testng"');
    expect(recognised(await detectProject(view({ 'pom.xml': '<project/>' }))).frameworks).toEqual(
      [],
    );
  });
});

describe('dotnet', () => {
  it('matches package ids case-insensitively and quotes the manifest in its own spelling', async () => {
    const result = recognised(
      await detectProject(
        view({
          'src/App.Tests/App.Tests.csproj': '<PackageReference Include="nunit" Version="4" />',
        }),
      ),
    );
    const nunit = result.frameworks.find((f) => f.name === 'nunit');
    expect(nunit).toBeDefined();
    expect(result.confidence).toBe(0.85);
    expect(result.candidateCommands[0]?.evidence).toBe('src/App.Tests/App.Tests.csproj');
  });

  it('is only moderately confident when no test package is referenced', async () => {
    const result = recognised(await detectProject(view({ 'App.csproj': '<Project Sdk="x"/>' })));
    expect(result.frameworks).toEqual([]);
    expect(result.confidence).toBe(0.6);
  });

  it('escapes regex metacharacters in a package id when restoring its spelling', async () => {
    const result = recognised(
      await detectProject(
        view({ 'a.csproj': '<PackageReference Include="Microsoft.NET.Test.Sdk" />' }),
      ),
    );
    expect(result.frameworks.find((f) => f.name === 'microsoft.net.test.sdk')?.evidence).toBe(
      'a.csproj:1 <PackageReference Include="microsoft.net.test.sdk" />',
    );
  });
});

describe('node', () => {
  it('is only moderately confident with no test script and no dependency', async () => {
    const result = recognised(await detectProject(view({ 'package.json': '{"name":"x"}' })));
    expect(result.confidence).toBe(0.5);
    expect(result.candidateCommands).toEqual([]);
    expect(result.packageManager).toBe('npm');
  });

  it('is confident when there are dependencies even with no test script', async () => {
    const result = recognised(
      await detectProject(view({ 'package.json': '{"dependencies":{"left-pad":"1"}}' })),
    );
    expect(result.confidence).toBe(0.9);
  });

  it('proposes only test scripts, ranked with plain `test` first', async () => {
    const result = recognised(
      await detectProject(
        view({
          'package.json': JSON.stringify({
            scripts: { build: 'tsc', 'test:b': 'x', test: 'y', 'test:a': 'z', testing: 'no' },
          }),
          'yarn.lock': '',
        }),
      ),
    );
    expect(result.candidateCommands.map((c) => c.id)).toEqual([
      'node.test',
      'node.test:a',
      'node.test:b',
    ]);
    expect(result.candidateCommands[0]?.argv).toEqual(['yarn', 'test']);
    expect(result.candidateCommands[1]?.argv).toEqual(['yarn', 'run', 'test:a']);
  });

  it('classifies `test:unit` as unit, so the score does not read it as integration', async () => {
    const result = recognised(
      await detectProject(
        view({ 'package.json': JSON.stringify({ scripts: { 'test:unit': 'vitest' } }) }),
      ),
    );
    expect(result.candidateCommands[0]?.category).toBe('unit');
  });
});

describe('php', () => {
  it('prefers the project’s own test script over the bare binary', async () => {
    const result = recognised(
      await detectProject(
        view({
          'composer.json': JSON.stringify({
            'require-dev': { 'phpunit/phpunit': '^11' },
            scripts: { test: 'phpunit --colors', 'test-unit': 'x' },
          }),
        }),
      ),
    );
    expect(result.candidateCommands.map((c) => c.id)).toEqual(['php.composer-test']);
    expect(result.confidence).toBe(0.85);
  });

  it('falls back to vendor/bin/phpunit and cites the dependency when there is one', async () => {
    const withPhpunit = recognised(
      await detectProject(
        view({ 'composer.json': '{\n"require-dev": {"phpunit/phpunit": "^11"}\n}' }),
      ),
    );
    expect(withPhpunit.candidateCommands[0]).toMatchObject({
      id: 'php.phpunit',
      evidence: 'composer.json:2 "require-dev": {"phpunit/phpunit": "^11"}',
    });
  });

  it('cites the manifest alone when phpunit is not a dependency', async () => {
    const bare = recognised(
      await detectProject(view({ 'composer.json': '{"require":{"a/b":"1"}}' })),
    );
    expect(bare.candidateCommands[0]?.evidence).toBe('composer.json');
    expect(bare.frameworks).toEqual([]);
    expect(bare.confidence).toBe(0.6);
  });

  it('does not take a script that merely starts with "test" for the test script', async () => {
    const result = recognised(
      await detectProject(view({ 'composer.json': '{"scripts":{"test-unit":"x"}}' })),
    );
    expect(result.candidateCommands[0]?.id).toBe('php.phpunit');
  });
});

describe('python', () => {
  it('falls back to unittest, citing the first manifest, when pytest is not declared', async () => {
    const result = recognised(await detectProject(view({ 'requirements.txt': 'requests==2\n' })));
    expect(result.candidateCommands[0]).toMatchObject({
      id: 'python.unittest',
      argv: ['python', '-m', 'unittest', 'discover'],
      evidence: 'requirements.txt',
      confidence: 0.5,
    });
    expect(result.packageManager).toBe('pip');
  });

  it('reads pytest from requirements, ignoring comments, options and blank lines', async () => {
    const result = recognised(
      await detectProject(
        view({
          'requirements.txt':
            '# pytest is great\n\n-r base.txt\nPyTest>=7 ; python_version>"3.8"\n',
        }),
      ),
    );
    expect(result.candidateCommands[0]?.id).toBe('python.pytest');
    expect(result.candidateCommands[0]?.evidence).toBe('requirements.txt:1 # pytest is great');
  });

  it('keeps both frameworks when one name is a prefix of the other and they share a line', async () => {
    // Frameworks are folded by the manifest line that evidences them, and the evidence for
    // pytest is the first line containing the substring - which is the pytest-cov line
    // when that comes first. The fold then dropped one of two distinct frameworks.
    const result = recognised(
      await detectProject(view({ 'requirements.txt': 'pytest-cov==5\npytest==8\n' })),
    );
    expect(result.frameworks.map((f) => f.name).sort()).toEqual(['pytest', 'pytest-cov']);
  });

  it.each([
    ['uv.lock', 'uv'],
    ['poetry.lock', 'poetry'],
    ['Pipfile.lock', 'pipenv'],
  ])('takes the package manager from %s', async (lock, manager) => {
    const result = recognised(
      await detectProject(view({ 'pyproject.toml': '[project]\nname = "x"\n', [lock]: '' })),
    );
    expect(result.packageManager).toBe(manager);
  });

  it('finds pytest declared with extras in a dependency group', async () => {
    const result = recognised(
      await detectProject(
        view({
          'pyproject.toml': '[dependency-groups]\ndev = ["pytest[cov]>=8", "ruff"]\n',
        }),
      ),
    );
    expect(result.frameworks.map((f) => f.name)).toContain('pytest');
  });
});

describe('ruby', () => {
  it('proposes rake test as the floor when nothing else is known', async () => {
    const result = recognised(
      await detectProject(view({ Gemfile: "source 'https://rubygems.org'\n" })),
    );
    expect(result.candidateCommands.map((c) => c.argv.join(' '))).toEqual([
      'bundle exec rake test',
    ]);
    expect(result.confidence).toBe(0.55);
    expect(result.packageManager).toBe('bundler');
  });

  it('prefers rspec, then the Rakefile, and is confident with a Rakefile alone', async () => {
    const result = recognised(
      await detectProject(
        view({ Gemfile: "gem 'rspec'\n", Rakefile: '', 'lib/tasks/Rakefile': '' }),
      ),
    );
    expect(result.candidateCommands.map((c) => c.id)).toEqual([
      'ruby.rspec',
      'ruby.rake',
      'ruby.rake.test',
    ]);

    const rakeOnly = recognised(await detectProject(view({ Gemfile: '', 'sub/Rakefile': '' })));
    expect(rakeOnly.confidence).toBe(0.85);
  });

  it('cites the gemspec when that is where the framework is declared', async () => {
    const result = recognised(
      await detectProject(
        view({
          Gemfile: 'gemspec\n',
          'rack.gemspec': "s.add_development_dependency 'minitest', '> 5'\n",
        }),
      ),
    );
    const minitest = result.frameworks.find((f) => f.name === 'minitest');
    expect(minitest?.evidence).toBe(
      "rack.gemspec:1 s.add_development_dependency 'minitest', '> 5'",
    );
  });

  it('reports a gemspec-only repository as ruby rather than bundler', async () => {
    const result = recognised(
      await detectProject(view({ 'lib.gemspec': "s.add_development_dependency 'rspec'\n" })),
    );
    expect(result.packageManager).toBe('ruby');
  });
});
