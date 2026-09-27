/**
 * The axe assertion for the client suite.
 *
 * A copy of `packages/ui/src/test/axe.ts` rather than an import of it: the two
 * packages are separate Vitest projects, and the shared file is a source file in
 * `packages/ui/src` that would count toward that package's coverage for no
 * benefit — the copy is the only duplication, and it is a dozen lines.
 *
 * Only `serious` and `critical` findings block, and `color-contrast` is off
 * because jsdom has no geometry for axe to measure and the fallback path calls
 * `HTMLCanvasElement.getContext`, which jsdom does not implement. Token contrast
 * is asserted against the real stylesheet in `packages/ui/src/tokens/theme.test.ts`.
 */
import { axe } from 'vitest-axe';
import { expect } from 'vitest';

interface BlockingViolation {
  id: string;
  impact: string;
  help: string;
  nodes: string[][];
}

export async function expectNoBlockingAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  const blocking: BlockingViolation[] = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.map(String)),
    }));

  expect(
    blocking,
    'axe found serious or critical violations. Fix the component — do not relax the ' +
      'rule and do not exclude the component.',
  ).toEqual([]);
}
