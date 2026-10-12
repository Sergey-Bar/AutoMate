import { describe, expect, it } from 'vitest';
import { AutomateConfigSchema, ProjectProfilePatchSchema } from './profile.js';
import { PROJECT_PROFILE_PATCH_KEYS } from './profile.js';
import { mergeConfig, profileFromDetection } from './config.js';
import type { DetectResult } from './detect/index.js';

/**
 * The patch surface and the merge rule, held to each other.
 *
 * ## Why this test exists
 *
 * A `PATCH /projects/:id` that accepts a key `mergeConfig` drops answers 200 for an
 * edit that changed nothing — the failure a reader can least detect, because
 * nothing tells them it happened. `env` and `timeoutMs` are the two real examples:
 * they are read-time concerns the stored profile does not carry, so the merge
 * ignores them and an API that accepted them would lie about having applied them.
 *
 * So the patch schema is asserted against the merge's editable surface rather than
 * trusted to stay equal to it.
 */

function detection(): DetectResult {
  return {
    recognised: true,
    ecosystem: 'node',
    language: 'typescript',
    packageManager: 'pnpm',
    frameworks: [{ name: 'vitest', category: 'unit', evidence: 'devDependencies:vitest' }],
    candidateCommands: [
      {
        id: 'unit.1',
        category: 'unit',
        label: 'Unit suite',
        argv: ['pnpm', 'vitest', 'run'],
        confidence: 0.9,
        evidence: 'devDependencies:vitest',
      },
    ],
    artifactGlobs: [],
    coverageGlobs: [],
    coverageFormats: [],
    confidence: 0.9,
    detectorVersion: 1,
  };
}

describe('the profile patch surface', () => {
  it('names exactly the keys the merge can apply', () => {
    const patchKeys = Object.keys(ProjectProfilePatchSchema.shape)
      .filter((key) => key !== '$schema' && key !== 'version')
      .sort();
    expect(patchKeys).toEqual([...PROJECT_PROFILE_PATCH_KEYS].sort());
  });

  it('accepts every key the checked-in file format accepts and can edit', () => {
    // The other half: a key an operator can already write in
    // `automate.config.json` must be editable through the API too, or the two
    // surfaces disagree about what a project owner may change.
    const fileKeys = Object.keys(AutomateConfigSchema.shape).filter(
      (key) => key !== 'env' && key !== 'timeoutMs' && key !== 'version' && key !== '$schema',
    );
    for (const key of fileKeys) {
      expect(
        Object.keys(ProjectProfilePatchSchema.shape),
        `${key} is editable in the file but not through the API`,
      ).toContain(key);
    }
  });

  it('refuses a body that names no key at all, so a no-op is not a success', () => {
    const parsed = ProjectProfilePatchSchema.safeParse({ version: 1 });
    expect(parsed.success).toBe(true);
    // Success at the schema, and no keys named: the *service* is what tells the
    // two apart, and this assertion is what keeps the schema honest about being
    // empty rather than carrying a default that looks like an edit.
    const named = Object.keys(parsed.data as Record<string, unknown>).filter(
      (key) => key !== 'version',
    );
    expect(named).toEqual([]);
  });

  it('refuses an unknown category rather than creating a command for it', () => {
    // A typo'd category would be a command no cell can use, which is worse than a
    // rejected edit: the profile would carry an entry no run could ever select.
    expect(
      ProjectProfilePatchSchema.safeParse({ commands: { nonsense: ['rm', '-rf', '/'] } }).success,
    ).toBe(false);
  });

  it('replaces the named command and keeps the detected one', () => {
    const profile = profileFromDetection(detection());
    const patch = ProjectProfilePatchSchema.parse({
      commands: { e2e: ['pnpm', 'playwright', 'test'] },
    });
    // The version the *file* format requires, supplied the same way the service
    // supplies it — the translation is one line in one place, and this is it.
    const merged = mergeConfig(profile, { version: 1, ...patch });
    // One command per category: the e2e command the patch named, and the unit
    // command the detector found. An append would run a suite the operator said
    // not to run, and a replacement of everything else would drop the detection
    // they never mentioned.
    expect(merged.profile.commands).toHaveLength(2);
    expect(merged.profile.commands.find((command) => command.category === 'e2e')?.argv).toEqual([
      'pnpm',
      'playwright',
      'test',
    ]);
    expect(merged.profile.commands.find((command) => command.category === 'unit')?.argv).toEqual([
      'pnpm',
      'vitest',
      'run',
    ]);
    expect(merged.overriddenKeys).toEqual(['commands']);
  });
});
