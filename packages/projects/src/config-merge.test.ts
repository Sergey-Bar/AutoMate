import { describe, expect, it } from 'vitest';

import { mergeConfig, profileFromDetection } from './config.js';
import { detectProject } from './detect/index.js';
import { literalView } from './detect/repository-view.js';
import { ProjectProfileSchema } from './profile.js';

const UNRECOGNISED = { 'README.md': '# nothing to detect here\n' };

const NODE = {
  'package.json': JSON.stringify({
    scripts: { test: 'vitest run', 'test:e2e': 'playwright test' },
    devDependencies: { vitest: '^4.1.5' },
  }),
};

async function base(files: Record<string, string>) {
  return profileFromDetection(await detectProject(literalView(files)));
}

describe('a repository no detector recognises', () => {
  it('is stored as a profile of nulls and empty lists, not an error', async () => {
    const detection = await detectProject(literalView(UNRECOGNISED));
    expect(detection.recognised).toBe(false);
    const profile = profileFromDetection(detection);
    expect(profile).toMatchObject({
      ecosystem: null,
      language: null,
      packageManager: null,
      commands: [],
      artifactGlobs: [],
      coverageGlobs: [],
      coverageFormats: [],
    });
    expect(profile.detectorVersion).toBe(detection.detectorVersion);
  });

  it('accepts a declared command, which is how such a repository is registered', async () => {
    const { profile, source, overriddenKeys } = mergeConfig(await base(UNRECOGNISED), {
      version: 1,
      commands: { unit: ['make', 'test'] },
    });
    expect(source).toBe('override');
    expect(overriddenKeys).toEqual(['commands']);
    expect(profile.commands).toHaveLength(1);
    expect(profile.commands[0]).toMatchObject({ argv: ['make', 'test'], category: 'unit' });
    // An operator statement is as certain as a confidence can be.
    expect(profile.commands[0]?.confidence).toBe(1);
    expect(profile.commands[0]?.evidence).toBe('automate.config.json#commands.unit');
  });
});

describe('mergeConfig leaves what the config does not mention', () => {
  it('is a no-op for a config that sets nothing but its version', async () => {
    const detected = await base(NODE);
    const merged = mergeConfig(detected, { version: 1, $schema: 'https://example.test/s.json' });
    expect(merged.source).toBe('detected');
    expect(merged.overriddenKeys).toEqual([]);
    // `toStrictEqual` also fails on a key that exists with the value `undefined`.
    expect(merged.profile).toStrictEqual(detected);
  });

  it('keeps detected commands in categories the config did not declare', async () => {
    const detected = await base(NODE);
    const { profile } = mergeConfig(detected, { version: 1, commands: { unit: ['npm', 't'] } });
    const e2e = profile.commands.filter((command) => command.category === 'e2e');
    expect(e2e).toEqual(detected.commands.filter((command) => command.category === 'e2e'));
    const unit = profile.commands.filter((command) => command.category === 'unit');
    expect(unit.map((command) => command.argv)).toEqual([['npm', 't']]);
  });
});

describe('mergeConfig on targets', () => {
  const baseline = ProjectProfileSchema.parse({
    detectorVersion: 1,
    ecosystem: null,
    language: null,
    packageManager: null,
    targets: {
      testsPerCell: { 'unit/backend': 3, 'unit/frontend': 2 },
      coverageTarget: { backend: 0.8, frontend: 0.6 },
      pyramid: { unit: 0.7, integration: 0.2, e2e: 0.1 },
    },
  });

  it('merges one target at a time so a config setting one loses none of the others', () => {
    const { profile } = mergeConfig(baseline, {
      version: 1,
      targets: { testsPerCell: { 'unit/backend': 9 }, coverageTarget: { backend: 0.95 } },
    });
    expect(profile.targets.testsPerCell).toEqual({ 'unit/backend': 9, 'unit/frontend': 2 });
    expect(profile.targets.coverageTarget).toEqual({ backend: 0.95, frontend: 0.6 });
    // The pyramid was not declared, so the detected one stands.
    expect(profile.targets.pyramid).toEqual({ unit: 0.7, integration: 0.2, e2e: 0.1 });
  });

  it('replaces the pyramid wholesale when the config declares one', () => {
    const pyramid = { unit: 0.5, integration: 0.3, e2e: 0.2 };
    const { profile } = mergeConfig(baseline, { version: 1, targets: { pyramid } });
    expect(profile.targets.pyramid).toEqual(pyramid);
    expect(profile.targets.testsPerCell).toEqual(baseline.targets.testsPerCell);
  });

  it('does not add a pyramid key when neither side has one', async () => {
    const detected = await base(NODE);
    expect(detected.targets.pyramid).toBeUndefined();
    const { profile } = mergeConfig(detected, { version: 1, targets: { testsPerCell: { a: 1 } } });
    expect('pyramid' in profile.targets).toBe(false);
    expect(profile.targets.testsPerCell).toEqual({ a: 1 });
  });

  it('accepts an empty targets object as "change nothing"', () => {
    const { profile } = mergeConfig(baseline, { version: 1, targets: {} });
    expect(profile.targets).toStrictEqual(baseline.targets);
  });
});

describe('mergeConfig on lists', () => {
  it('replaces a declared list and keeps an undeclared one', async () => {
    const detected = await base(NODE);
    const { profile, overriddenKeys } = mergeConfig(detected, {
      version: 1,
      coverageGlobs: [{ glob: 'cov/lcov.info', format: 'lcov' }],
      coverageFormats: ['lcov'],
      excludedCells: [{ category: 'security', surface: 'frontend' }],
    });
    expect(profile.coverageGlobs).toEqual([{ glob: 'cov/lcov.info', format: 'lcov' }]);
    expect(profile.coverageFormats).toEqual(['lcov']);
    expect(profile.excludedCells).toEqual([{ category: 'security', surface: 'frontend' }]);
    expect(profile.artifactGlobs).toEqual(detected.artifactGlobs);
    expect(overriddenKeys).toEqual(['coverageGlobs', 'coverageFormats', 'excludedCells']);
  });

  it('refuses a config that is not valid, rather than merging part of it', async () => {
    const detected = await base(NODE);
    expect(() => mergeConfig(detected, { version: 2 })).toThrow();
    expect(() => mergeConfig(detected, { version: 1, coverageFormats: [] })).toThrow();
  });
});
