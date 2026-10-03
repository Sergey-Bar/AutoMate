import { describe, expect, it } from 'vitest';

import { literalView } from './repository-view.js';
import { DETECTOR_VERSION, detectProject } from './index.js';

/**
 * One fixture repository per ecosystem, each the smallest file that makes the
 * detector answer with a language, a framework, and a candidate command.
 *
 * This is the W0 exit criterion. They are literal maps rather than directories on
 * disk because a fixture's contents are the assertion: when `detectNode` stops
 * recognising this repository, the diff shows exactly which manifest line moved,
 * and there is nothing on disk for `git clean` to be blamed for.
 */
const FIXTURES: ReadonlyArray<{
  ecosystem: string;
  files: Record<string, string>;
}> = [
  {
    ecosystem: 'go',
    files: {
      'go.mod': 'module example.com/svc\n\ngo 1.22\n\nrequire github.com/stretchr/testify v1.9.0\n',
      'main.go': 'package main\n',
      'internal/auth/auth.go': 'package auth\n',
    },
  },
  {
    ecosystem: 'rust',
    files: {
      'Cargo.toml':
        '[package]\nname = "svc"\nversion = "0.1.0"\n\n[dev-dependencies]\nnextest = "0.9"\n',
      'src/lib.rs': 'pub fn add(a: u32, b: u32) -> u32 { a + b }\n',
    },
  },
  {
    ecosystem: 'java',
    files: {
      'pom.xml':
        '<project><dependencies><dependency><artifactId>junit-jupiter</artifactId></dependency>' +
        '<dependency><artifactId>failsafe</artifactId></dependency></dependencies></project>\n',
      'src/main/java/App.java': 'class App {}\n',
    },
  },
  {
    ecosystem: 'dotnet',
    files: {
      'src/Api/Api.csproj':
        '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>\n',
      'src/Api/Program.cs': 'class Program {}\n',
    },
  },
  {
    ecosystem: 'node',
    files: {
      'package.json': JSON.stringify({
        name: 'svc',
        scripts: { test: 'vitest run', 'test:e2e': 'playwright test' },
        devDependencies: { vitest: '^4.1.5', '@playwright/test': '^1.63.0' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    },
  },
  {
    ecosystem: 'python',
    files: {
      'pyproject.toml':
        '[project]\nname = "svc"\n\n[project.optional-dependencies]\ndev = ["pytest>=7.4"]\n',
      'uv.lock': 'version = 1\n',
      'src/svc/__init__.py': '',
    },
  },
  {
    ecosystem: 'ruby',
    files: {
      Gemfile: "source 'https://rubygems.org'\n\ngem 'rspec', '~> 3.13'\ngem 'simplecov'\n",
      'Gemfile.lock': 'GEM\n',
      Rakefile: 'task default: :spec\n',
    },
  },
  {
    ecosystem: 'php',
    files: {
      'composer.json': JSON.stringify({
        require: { 'phpunit/phpunit': '^11.0' },
        'require-dev': {},
        scripts: { test: 'phpunit' },
      }),
      'composer.lock': '{}\n',
    },
  },
];

describe('the v1 detection matrix', () => {
  it('covers all eight ecosystems the plan names', () => {
    expect(FIXTURES.map((fixture) => fixture.ecosystem)).toEqual([
      'go',
      'rust',
      'java',
      'dotnet',
      'node',
      'python',
      'ruby',
      'php',
    ]);
  });

  for (const fixture of FIXTURES) {
    it(`detects ${fixture.ecosystem}: a language, a framework, and a candidate command`, async () => {
      const result = await detectProject(literalView(fixture.files));

      expect(result.recognised, 'the fixture must be recognised').toBe(true);
      if (!result.recognised) return;

      expect(result.ecosystem).toBe(fixture.ecosystem);
      expect(result.language).not.toBeNull();
      expect(result.frameworks.length, 'a framework signal').toBeGreaterThan(0);
      expect(result.candidateCommands.length, 'a candidate command').toBeGreaterThan(0);
      // The W0 exit criterion is a *usable* proposal, so every candidate carries
      // the argv a runner can spawn and the manifest line that produced it.
      expect(result.candidateCommands[0]?.argv.length).toBeGreaterThan(0);
      expect(result.candidateCommands[0]?.evidence.length).toBeGreaterThan(0);
      expect(result.detectorVersion).toBe(DETECTOR_VERSION);
    });
  }
});
