/**
 * The axe assertion used by every accessibility test in this package.
 *
 * It lives here rather than being retyped per file because the failure message is
 * the point: a test that only said "a11y failed" would be unfixable without
 * first working out which rule, which node and which element. Every failure
 * names the rule, its impact, and the exact target within the container.
 *
 * Only `serious` and `critical` are treated as blocking, which is the target
 * stated for this work: WCAG 2.2 AA for a dashboard that has to be operable.
 * `minor` and `moderate` findings are still real and are fixed when cheap, but
 * they are not the gate — a gate that fires on a missing `lang` attribute in a
 * test container gets switched off.
 *
 * Note what this cannot see: axe computes colour contrast from rendered
 * geometry, and jsdom has none, so the `color-contrast` rule is skipped entirely.
 * Token contrast is asserted against the stylesheet itself, in
 * `src/tokens/theme.test.ts`. This helper is the half of accessibility that
 * needs a DOM, and that test is the half that needs the real theme.
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
    rules: {
      /*
       * Disabled rather than ignored-by-accident. `color-contrast` needs rendered
       * geometry to decide anything, jsdom has none, and axe's fallback path
       * calls `HTMLCanvasElement.getContext`, which jsdom does not implement — so
       * the rule produces a wall of "Not implemented" noise and no verdict. The
       * coverage it would provide is in `src/tokens/theme.test.ts`, which
       * computes the real ratios from the shipped stylesheet.
       */
      'color-contrast': { enabled: false },
    },
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
