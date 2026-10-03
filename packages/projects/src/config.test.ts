import { describe, expect, it } from 'vitest';

import { mergeConfig, profileFromDetection } from './config.js';
import { AutomateConfigSchema } from './profile.js';
import { literalView } from './detect/repository-view.js';
import { detectProject } from './detect/index.js';

/** A repository whose detection is stable and small enough to reason about. */
const NODE_REPO = {
  'package.json': JSON.stringify({
    name: 'svc',
    scripts: { test: 'vitest run', 'test:e2e': 'playwright test' },
    devDependencies: { vitest: '^4.1.5', '@playwright/test': '^1.63.0' },
  }),
  'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
};

async function detectedProfile() {
  return profileFromDetection(await detectProject(literalView(NODE_REPO)));
}

describe('a declared command is argv, never a shell string (D7)', () => {
  it('refuses a config whose command is a string', () => {
    // The shape of the refusal is the point: `commands.unit` is
    // `string[] | undefined`, so `"pytest && rm -rf build"` is a type error in
    // the customer's editor, a Zod error at the boundary, and — because nothing
    // in this repository ever concatenates these into a shell line — impossible
    // to execute at all. A config that *could* hold a string would be the raw
    // shell passthrough D7 rules out, wearing a file extension.
    const result = AutomateConfigSchema.safeParse({
      version: 1,
      commands: { unit: 'pytest -q' },
    });
    expect(result.success).toBe(false);
  });

  it('refuses a config that declares an unknown category', () => {
    const result = AutomateConfigSchema.safeParse({
      version: 1,
      commands: { smoke: ['make', 'smoke'] },
    });
    expect(result.success).toBe(false);
  });

  it('refuses a config with no version, rather than assuming one', () => {
    const result = AutomateConfigSchema.safeParse({ commands: { unit: ['pytest'] } });
    expect(result.success).toBe(false);
  });

  it('never emits a candidate command as a single string', async () => {
    const detection = await detectProject(literalView(NODE_REPO));
    expect(detection.recognised).toBe(true);
    if (!detection.recognised) return;
    for (const candidate of detection.candidateCommands) {
      expect(Array.isArray(candidate.argv)).toBe(true);
      expect(candidate.argv.every((part) => typeof part === 'string')).toBe(true);
      expect(candidate.argv).not.toHaveLength(0);
    }
  });
});

describe('a checked-in override always wins over detection', () => {
  it('replaces the detected command for its category rather than appending', async () => {
    const base = await detectedProfile();
    const detectedUnit = base.commands.find((command) => command.category === 'unit');

    const merged = mergeConfig(base, {
      version: 1,
      commands: { unit: ['pytest', '-q', 'tests/unit'] },
    });

    const unitCommands = merged.profile.commands.filter((command) => command.category === 'unit');
    // One, not two. Appending would make the config a *supplement*, and a file
    // that supplements a guess is still a guess — worse, it would run a suite the
    // operator said not to run.
    expect(unitCommands).toHaveLength(1);
    expect(unitCommands[0]?.argv).toEqual(['pytest', '-q', 'tests/unit']);
    expect(unitCommands[0]?.evidence).toBe('automate.config.json#commands.unit');
    // And it is not the detected one.
    expect(unitCommands[0]?.argv).not.toEqual(detectedUnit?.argv);
  });

  it('leaves categories the config says nothing about exactly as detected', async () => {
    const base = await detectedProfile();
    const merged = mergeConfig(base, { version: 1, commands: { unit: ['pytest'] } });
    expect(merged.profile.commands.filter((command) => command.category === 'e2e')).toEqual(
      base.commands.filter((command) => command.category === 'e2e'),
    );
  });

  it('records which keys were overridden, so a score can be explained', async () => {
    const base = await detectedProfile();
    const merged = mergeConfig(base, {
      $schema: 'https://automate.dev/schema/automate.config.json',
      version: 1,
      timeoutMs: 60_000,
      commands: { unit: ['pytest'] },
      env: ['CI_TOKEN'],
    });
    // `$schema` and `version` are not overrides; a provenance panel listing them
    // would be reporting the file's own metadata as the operator's decisions.
    expect(merged.overriddenKeys.sort()).toEqual(['commands', 'env', 'timeoutMs']);
    expect(merged.source).toBe('override');
  });

  it('reports `detected` when the config declares nothing beyond its version', async () => {
    const base = await detectedProfile();
    const merged = mergeConfig(base, { version: 1 });
    expect(merged.source).toBe('detected');
    expect(merged.overriddenKeys).toEqual([]);
    expect(merged.profile).toEqual(base);
  });

  it('outranks the detector on confidence, so a declared command wins a tie', async () => {
    // The dangerous alternative is "the override wins when the detector is
    // unsure" — which is a detector that can overrule the operator whenever it
    // likes, wearing a confidence score as camouflage.
    const base = await detectedProfile();
    const merged = mergeConfig(base, { version: 1, commands: { e2e: ['make', 'e2e'] } });
    const declared = merged.profile.commands.find(
      (command) => command.category === 'e2e' && command.id === 'declared.e2e',
    );
    expect(declared?.confidence).toBe(1);
  });

  it('merges targets field by field rather than replacing the map', async () => {
    const base = await detectedProfile();
    base.targets.coverageTarget = { backend: 0.7, frontend: 0.6 };
    base.targets.testsPerCell = { 'unit:backend': 40 };

    const merged = mergeConfig(base, {
      version: 1,
      targets: { coverageTarget: { backend: 0.85 } },
    });

    expect(merged.profile.targets.coverageTarget).toEqual({ backend: 0.85, frontend: 0.6 });
    expect(merged.profile.targets.testsPerCell).toEqual({ 'unit:backend': 40 });
  });

  it('refuses an override with a nonsense target rather than scoring against it', async () => {
    // A coverage target of 4 would make `min(1, surfaceCoverage / target)` a
    // number nobody can interpret, and a score that divides by a nonsense target
    // is a score that looks fine and means nothing.
    const base = await detectedProfile();
    expect(() =>
      mergeConfig(base, { version: 1, targets: { coverageTarget: { backend: 4 } } }),
    ).toThrow();
  });
});
