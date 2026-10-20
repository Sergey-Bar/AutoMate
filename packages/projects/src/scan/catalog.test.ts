import { describe, expect, it } from 'vitest';
import { QA_CAPABILITIES, RepoScanSchema } from '@automate/shared-contracts';
import { literalView } from '../detect/repository-view.js';
import { TOOL_CATALOG } from './catalog.js';
import { CAPABILITY_WEIGHTS, scanRepository } from './index.js';

const NOW = new Date('2026-10-20T00:00:00.000Z');

/**
 * The catalogue's invariants. A catalogue is data, and data with no test is a list somebody
 * typed: a duplicated id silently shadows its twin, a paid tool with no vendor page is a
 * recommendation to go and search for a price, and a capability with only paid options
 * makes "what should I add" an answer that costs money.
 */
describe('the toolbox catalogue', () => {
  it('is comprehensive: well over a hundred tools, in every tier', () => {
    expect(TOOL_CATALOG.length).toBeGreaterThanOrEqual(120);
    const tiers = new Set(TOOL_CATALOG.map((tool) => tool.pricing));
    expect([...tiers].sort()).toEqual(['free', 'freemium', 'paid']);
    expect(TOOL_CATALOG.filter((tool) => tool.pricing === 'paid').length).toBeGreaterThanOrEqual(
      20,
    );
  });

  it('gives every tool a unique id and an https documentation link', () => {
    const ids = TOOL_CATALOG.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of TOOL_CATALOG) {
      expect(tool.docsUrl, tool.id).toMatch(/^https:\/\//u);
      if (tool.vendorUrl !== undefined) expect(tool.vendorUrl, tool.id).toMatch(/^https:\/\//u);
    }
  });

  it('links every paid tool to its vendor, because the product records no prices', () => {
    for (const tool of TOOL_CATALOG.filter((candidate) => candidate.pricing === 'paid')) {
      expect(tool.vendorUrl, `${tool.id} is paid and has no vendorUrl`).toBeDefined();
    }
  });

  it('offers at least one free tool for every capability', () => {
    for (const capability of QA_CAPABILITIES) {
      expect(
        TOOL_CATALOG.some((tool) => tool.capability === capability && tool.pricing === 'free'),
        `${capability} has no free tool`,
      ).toBe(true);
    }
  });

  it('never marks a paid tool as the preferred pick', () => {
    expect(
      TOOL_CATALOG.filter((tool) => tool.preferred === true && tool.pricing === 'paid'),
    ).toEqual([]);
  });

  it('weighs every capability, and keeps the two optional ones out of maturity', () => {
    for (const capability of QA_CAPABILITIES)
      expect(CAPABILITY_WEIGHTS[capability]).toBeGreaterThanOrEqual(0);
    expect(CAPABILITY_WEIGHTS.mobile).toBe(0);
    expect(CAPABILITY_WEIGHTS['test-management']).toBe(0);
  });
});

describe('the scan, against the expanded catalogue', () => {
  const node = JSON.stringify({ name: 'app', devDependencies: { vitest: '4.0.0' } });

  it('never recommends a paid tool or an optional capability, and labels every entry', async () => {
    const scan = await scanRepository(literalView({ 'package.json': node }), NOW);
    expect(RepoScanSchema.parse(scan)).toEqual(scan);
    const recommended = scan.toolbox.filter((entry) => entry.status === 'recommended');
    expect(recommended.length).toBeGreaterThan(0);
    expect(recommended.filter((entry) => entry.pricing === 'paid')).toEqual([]);
    expect(
      recommended.filter(
        (entry) => entry.capability === 'mobile' || entry.capability === 'test-management',
      ),
    ).toEqual([]);
    // A SaaS with nothing in the repository is listed, and only as available.
    expect(scan.toolbox.find((entry) => entry.id === 'xray')).toMatchObject({
      status: 'available',
      pricing: 'paid',
      vendorUrl: 'https://www.getxray.app/pricing',
    });
    expect(scan.toolbox.every((entry) => entry.pricing !== undefined)).toBe(true);
  });

  it('detects paid and freemium tools from the files they own', async () => {
    const scan = await scanRepository(
      literalView({
        'package.json': JSON.stringify({
          name: 'app',
          devDependencies: { '@applitools/eyes-playwright': '1.0.0', '@wdio/cli': '9.0.0' },
        }),
        'browserstack.yml': 'userName: x',
        '.percy.yml': 'version: 2',
        'sonar-project.properties': 'sonar.projectKey=app',
        'codecov.yml': 'coverage: {}',
        'wdio.conf.ts': 'export const config = {}',
      }),
      NOW,
    );
    const status = (id: string) => scan.toolbox.find((entry) => entry.id === id)?.status;
    for (const id of [
      'browserstack',
      'percy',
      'sonarqube',
      'codecov',
      'applitools',
      'webdriverio',
    ]) {
      expect(status(id), id).toBe('in-use');
    }
    expect(scan.detected.find((tool) => tool.id === 'browserstack')?.evidence).toBe(
      'browserstack.yml',
    );
    expect(scan.detected.find((tool) => tool.id === 'applitools')?.evidence).toBe(
      '@applitools/eyes-playwright in package.json',
    );
  });

  it('reads dependency names out of Maven, Gradle, NuGet, Bundler and Composer manifests', async () => {
    const scan = await scanRepository(
      literalView({
        'pom.xml':
          '<project><dependencies><dependency><artifactId>junit-jupiter</artifactId></dependency>' +
          '<dependency><artifactId>rest-assured</artifactId></dependency></dependencies></project>',
        'android/build.gradle.kts':
          'plugins {\n  jacoco\n  id("info.solidsoft.pitest")\n}\ndependencies { androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1") }',
        'Api/Api.Tests.csproj':
          '<ItemGroup><PackageReference Include="xunit" Version="2.9.0" /></ItemGroup>',
        Gemfile: "source 'https://rubygems.org'\ngem 'rspec'\ngem \"rubocop\", require: false\n",
        'composer.json': JSON.stringify({ 'require-dev': { 'phpunit/phpunit': '^11' } }),
      }),
      NOW,
    );
    const detected = new Set(scan.detected.map((tool) => tool.id));
    for (const id of [
      'junit5',
      'rest-assured',
      'jacoco',
      'pitest',
      'espresso',
      'xunit',
      'rspec',
      'rubocop',
      'phpunit',
    ]) {
      expect(detected.has(id), id).toBe(true);
    }
    expect(scan.ecosystems).toEqual(expect.arrayContaining(['java', 'dotnet', 'ruby', 'php']));
  });

  it('recognises an iOS project, and offers it XCUITest', async () => {
    const scan = await scanRepository(
      literalView({
        'Package.swift': '// swift-tools-version:5.9',
        'AppUITests/LoginUITests.swift': 'import XCTest',
      }),
      NOW,
    );
    expect(scan.ecosystems).toContain('swift');
    expect(scan.toolbox.find((entry) => entry.id === 'xcuitest')?.status).toBe('in-use');
  });
});
