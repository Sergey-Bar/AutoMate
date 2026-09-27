import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MOTION_SCALE_VARIABLE,
  REDUCED_MOTION_DURATION,
  REDUCED_MOTION_SCALE,
  durationVariableName,
  motion,
  motionDurationDeclarations,
} from './motion.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const motionCss = readFileSync(path.join(here, 'motion.css'), 'utf8');

/**
 * The body of the `prefers-reduced-motion` block.
 *
 * Found by brace-matching from the at-rule rather than by matching up to the first
 * `}`, because the block contains a nested universal selector with its own braces.
 * A regex that stopped at the first closing brace would have asserted against half
 * the rule and passed.
 */
function reducedMotionBlock(css: string): string {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  if (start === -1) throw new Error('motion.css emits no prefers-reduced-motion rule');
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error('the prefers-reduced-motion rule in motion.css is never closed');
}

const reduced = reducedMotionBlock(motionCss);

describe('motion tokens', () => {
  it('still ships the durations and easings it always did', () => {
    expect(Object.keys(motion.duration)).toEqual(['75', '100', '150', '200', '300']);
    expect(Object.keys(motion.easing)).toEqual(['linear', 'in', 'out', 'in-out']);
  });
});

describe('the shipped stylesheet honours prefers-reduced-motion', () => {
  it('emits a prefers-reduced-motion rule at all', () => {
    // The reason this file exists: the media query appeared nowhere in the
    // repository, so a user who asked their OS to stop moving things still got a
    // drawer sliding in and a spinner turning.
    expect(motionCss).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('collapses the motion scale inside that rule', () => {
    expect(reduced).toContain(`${MOTION_SCALE_VARIABLE}: ${REDUCED_MOTION_SCALE};`);
    expect(motionCss).toContain(`${MOTION_SCALE_VARIABLE}: 1;`);
  });

  it('declares every duration in terms of that scale, so one line reaches all of them', () => {
    for (const [step, value] of Object.entries(motion.duration)) {
      const variable = durationVariableName(Number(step));
      expect(motionCss, `${variable} is not published by motion.css`).toContain(
        `${variable}: calc(${value} * var(${MOTION_SCALE_VARIABLE}));`,
      );
    }
    // And the generated form is what the stylesheet actually contains, so the
    // token module and the CSS cannot drift apart unnoticed.
    for (const declaration of motionDurationDeclarations().split('\n')) {
      expect(motionCss).toContain(declaration.trim());
    }
  });

  it('reaches even a duration added after the media query was written', () => {
    // This is the property the design buys: a new duration in `motion.duration`
    // needs no second edit anywhere, because the media query changes a multiplier
    // rather than a list. If a future author hard-codes `200ms` instead, this
    // fails and the next person learns why before shipping the regression.
    const unmultiplied = Object.entries(motion.duration).filter(
      ([, value]) => !motionCss.includes(`calc(${value} * var(${MOTION_SCALE_VARIABLE}))`),
    );
    expect(
      unmultiplied.map(([step]) => step),
      'these durations ignore the motion scale and will still animate under reduce',
    ).toEqual([]);
  });

  it('neutralises the Tailwind duration and animate utilities the components actually use', () => {
    // The components set their motion with `duration-150`, `transition-all`,
    // `animate-in` and `animate-pulse`, which compile to literal times. A scale
    // variable cannot reach them, so the rule has to clamp the properties
    // themselves or the drawer still slides.
    for (const declaration of [
      `animation-duration: ${REDUCED_MOTION_DURATION} !important;`,
      'animation-iteration-count: 1 !important;',
      `transition-duration: ${REDUCED_MOTION_DURATION} !important;`,
      'scroll-behavior: auto !important;',
    ]) {
      expect(reduced).toContain(declaration);
    }
    expect(reduced).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
  });

  it('uses a non-zero reduced duration, so completion events still fire', () => {
    // `0ms`/`0s` is treated by some engines as "never start this at all", which
    // silently drops the `animationend` a component is waiting on. `0.01ms` is
    // the idiom that avoids it.
    expect(REDUCED_MOTION_DURATION).not.toBe('0ms');
    expect(REDUCED_MOTION_DURATION).not.toBe('0s');
    expect(reduced).not.toMatch(/(?:animation|transition)-duration:\s*0(?:ms|s)\b/);
  });

  it('is loaded by the stylesheet the app actually serves', () => {
    const webRoot = path.resolve(here, '../../../..');
    const indexCss = readFileSync(path.join(webRoot, 'apps/web/src/index.css'), 'utf8');
    // A rule in a file nothing imports is a rule that does not exist.
    expect(indexCss).toMatch(/@import\s+['"][^'"]*tokens\/motion\.css['"];/);
  });
});
