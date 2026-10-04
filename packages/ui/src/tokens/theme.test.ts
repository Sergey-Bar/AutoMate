import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtInColorNames, colors, ramps, semanticColorTokens } from './colors.js';
import {
  GLASS_BLUR_PX,
  GLASS_MAX_RADIUS_PX,
  GLASS_MIN_FILL_PERCENT,
  GLASS_SATURATE,
} from './glass.js';
import { motion as motionTokens } from './motion.js';

/** The two surviving token groups, as the barrel no longer assembles them. */
const tokens = { colors, motion: motionTokens };

const here = path.dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(path.join(here, 'theme.css'), 'utf8');

/** `--color-<name>:` declarations inside the `@theme inline` block. */
function declaredColorNames(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

/** `--automate-*` variables defined in a theme block. */
function definedVariableNames(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/(--automate-[a-z0-9-]+)\s*:/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

function hexChannels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(...hexChannels(foreground));
  const b = relativeLuminance(...hexChannels(background));
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A contrast assertion with the number in the message.
 *
 * `expect(ratio).toBeGreaterThanOrEqual(minimum)` reports `expected 4.47 to be >=
 * 4.50`, which is true and useless: it does not say which token, on which surface, in
 * which theme, or what was being read. Every contrast case in this file reports all
 * four, because a failure here is a colour decision being revisited and the reader
 * needs to know which one.
 *
 * Exported rather than inlined so the message shape is identical everywhere — a
 * failure message that differs between two cases is a failure message somebody has to
 * decode twice.
 */
function expectAtLeast(ratio: number, minimum: number, what: string): void {
  expect(
    ratio,
    `${what} is ${ratio.toFixed(2)}:1, and owes ${minimum.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(minimum);
}

/** `#rrggbb` → linear-light sRGB, for the OKLab conversion below. */
function linearChannels(hex: string): [number, number, number] {
  return hexChannels(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
}

/**
 * OKLCH for a hex value — the space the palette's decisions are stated in.
 *
 * **Why hue needs OKLab and not HSL.** HSL hue is not perceptually uniform, and
 * the failure is specific: a saturated green and a saturated amber at "the same"
 * HSL lightness are nowhere near the same HSL lightness, so a ramp tuned by eye in
 * HSL drifts in lightness as the hue turns. OKLab's `a`/`b` axes are equal-
 * perceived-difference, so a hue rotation at constant `L` and `C` is a hue
 * rotation on screen. The conversion is Björn Ottosson's, which is the one
 * CSS Color 4 specifies.
 *
 * This is a *measurement* helper, not a second palette: nothing here is written
 * into `theme.css`. It exists so the "hues are hue-distinct" claim can be
 * asserted instead of described — see the `the hues are the ones the decision
 * names` block, which is the assertion a contrast ratio cannot make.
 */
function oklch(hex: string): { lightness: number; chroma: number; hue: number } {
  const [r, g, b] = linearChannels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const blue = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = ((Math.atan2(blue, a) * 180) / Math.PI + 360) % 360;
  return { lightness, chroma: Math.hypot(a, blue), hue };
}

/**
 * The colour `foreground` at `alpha` opacity over `background`, as `#rrggbb`.
 *
 * `Alert` and `Toast` use `bg-success/10`, which the browser composites in
 * sRGB — not gamma-correctly — so this is the sRGB blend, not a luminance
 * average. Measuring the tint is the difference between testing what ships and
 * testing a colour nobody renders.
 */
function blend(foreground: string, background: string, alpha: number): string {
  const [fr, fg, fb] = hexChannels(foreground);
  const [br, bg, bb] = hexChannels(background);
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return `#${[mix(fr, br), mix(fg, bg), mix(fb, bb)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The declaration block for a selector.
 *
 * Whitespace- and quote-insensitive on the selector, because the stylesheet is
 * run through Prettier, which collapsed `:root,\n[data-theme="dark"]` onto two
 * lines with single quotes. Matching the exact source text made this test fail
 * on a formatting change rather than on a token change.
 */
function themeBlock(selector: string): string {
  const normalized = (text: string): string =>
    text.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  const wanted = normalized(selector);
  for (const match of themeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors, body] = match;
    if (selectors === undefined || body === undefined) continue;
    const each = selectors
      .split(',')
      .map((part) => normalized(part))
      .filter(Boolean);
    if (
      each.every((part) =>
        wanted
          .split(',')
          .map((part2) => normalized(part2))
          .includes(part),
      )
    ) {
      return body;
    }
  }
  throw new Error(`theme.css is missing a block for ${selector}`);
}

function variableValue(selector: string, variable: string): string {
  const match = new RegExp(`${variable}\\s*:\\s*([^;]+);`).exec(themeBlock(selector));
  if (!match?.[1]) throw new Error(`theme.css does not define ${variable} in ${selector}`);
  return match[1].trim();
}

/** The two theme blocks, matched by role rather than by exact source text. */
const DARK_SELECTOR = ':root,[data-theme="dark"]';
const LIGHT_SELECTOR = '[data-theme="light"]';
const BOTH_SELECTORS = [DARK_SELECTOR, LIGHT_SELECTOR];

const normalise = (text: string): string => text.replace(/["']/g, '').replace(/\s+/g, ' ').trim();

/**
 * Every `@theme` block in the stylesheet, concatenated, with comments removed.
 *
 * `@theme` and `@theme inline` are both read, and the two are told apart at the point
 * of use rather than here — `theme.css` puts the per-theme `color-mix` fills in an
 * `inline` block because they have to resolve against the theme in force, and a helper
 * that lost that distinction would let a literal into the block meant for references.
 *
 * **Comments are stripped before the at-rules are located**, because this stylesheet's
 * comments mention `@theme` by name several times: the elevation block's own header
 * says "This is a `@theme` block rather than `@theme inline`", and an `indexOf` that
 * did not strip comments would start a block at that sentence and pair it with the next
 * `{` in the file. The symptom is a scale that reads as absent while it is right there.
 *
 * Brace-matched rather than regex-matched, because the blocks contain nested rules and
 * a regex would stop at the first `}` and pass.
 */
function themeBlocks(): string {
  const declarationsOnly = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  let index = 0;
  for (;;) {
    const start = declarationsOnly.indexOf('@theme', index);
    if (start === -1) break;
    const open = declarationsOnly.indexOf('{', start);
    if (open === -1) break;
    let depth = 0;
    let closed = -1;
    for (let cursor = open; cursor < declarationsOnly.length; cursor += 1) {
      if (declarationsOnly[cursor] === '{') depth += 1;
      else if (declarationsOnly[cursor] === '}') {
        depth -= 1;
        if (depth === 0) {
          closed = cursor;
          break;
        }
      }
    }
    if (closed === -1) break;
    bodies.push(declarationsOnly.slice(open + 1, closed));
    index = closed + 1;
  }
  return bodies.join('\n');
}

/** The `@theme` declarations whose name starts with `prefix`, name → value. */
function themeScale(prefix: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const body of themeBlocks().split('\n')) {
    const match = new RegExp(
      `^\\s*(${prefix.replace(/-/g, '\\-')}[a-z0-9-]+)\\s*:\\s*(.+?);?\\s*$`,
    ).exec(body);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    // Modifiers stay in the map. `--text-xs--line-height` is a line-height rather than a
    // size, and a size lookup is an exact `get('--text-xs')`, so the extra key cannot be
    // mistaken for one.
    //
    // Filtering it out with `includes('--')` was the first attempt and it removed *every*
    // declaration in the stylesheet, because a custom property opens with `--`. The scale
    // then read as "theme.css declares nothing" from every call site at once, which is a
    // misleading failure rather than a merely wrong one.
    declared.set(match[1], match[2].trim());
  }
  return declared;
}

/** One declaration by exact name, wherever in the `@theme` blocks it sits. */
function themeValue(variable: string): string | undefined {
  const escaped = variable.replace(/-/g, '\\-');
  for (const line of themeBlocks().split('\n')) {
    const match = new RegExp(`^\\s*${escaped}\\s*:\\s*(.+?);?\\s*$`).exec(line);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return undefined;
}

/**
 * One declaration by exact name, **including a value that spans several lines**.
 *
 * `--automate-page-wash` is a two-stop gradient written across seven lines, and the
 * single-line reader above returned the first line of it — which then contained neither
 * `in oklab` nor a closing brace, and read as a declaration the product never made.
 * Anything that is not a scalar has to be read up to its terminator, which is why this is
 * a separate function rather than a flag on the other one.
 */
function themeValueBlock(variable: string): string | undefined {
  const blocks = themeBlocks();
  const start = blocks.search(new RegExp(`^\\s*${variable.replace(/-/g, '\\-')}\\s*:`, 'm'));
  if (start === -1) return undefined;
  const terminator = blocks.indexOf(';', start);
  return (terminator === -1 ? blocks.slice(start) : blocks.slice(start, terminator + 1)).trim();
}

/** A `rem` declaration as rem. Throws on anything else, because a typo is not a value. */
function rem(variable: string, scales: Map<string, string>): number {
  const raw = scales.get(variable);
  if (raw === undefined) throw new Error(`theme.css does not declare ${variable}`);
  const match = /^(-?[\d.]+)rem$/.exec(raw);
  if (match?.[1] === undefined) {
    throw new Error(`${variable} is "${raw}", which is not a rem length`);
  }
  return Number(match[1]);
}

/**
 * The order of a named scale, largest name last.
 *
 * Written out rather than derived, because the names are a *sequence* and a test that
 * sorted them would be testing its own comparator. `xs` and `sm` come first for the
 * reason given in the stylesheet: a dense console's caption and UI sizes sit below the
 * ladder's base step and are floored at 12px.
 */
const TYPE_STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'] as const;

/** The steps on the geometric ladder — everything at or above `base`. */
const LADDER_STEPS = TYPE_STEPS.slice(TYPE_STEPS.indexOf('base'));

const LEADING_STEPS = ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose'] as const;
const TRACKING_STEPS = ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'] as const;
const RADIUS_STEPS = ['none', 'sm', 'md', 'lg', 'xl', '2xl', 'full'] as const;
const Z_INDEX_STEPS = ['base', 'chrome', 'overlay', 'popover', 'modal', 'toast'] as const;

/** Every `.ts` module in this directory, as `{ name, body }`. */
function tokenSourceFiles(): Array<{ name: string; body: string }> {
  return readdirSync(here, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => ({
      name: entry.name,
      body: readFileSync(path.join(here, entry.name), 'utf8'),
    }));
}

/**
 * Every application source file that is not a test, as `{ name, body }`.
 *
 * Reached across the workspace rather than inside `packages/ui`, because the claim the wash
 * exclusion makes is about where a *product* component puts it and `AppShell` is the only
 * class that may. Walking the tree rather than importing it keeps this a source-level rule,
 * which is the level at which "one place puts the background" is even a question.
 */
function webSourceFiles(): Array<{ name: string; body: string }> {
  // Four levels, not three: `here` is `packages/ui/src/tokens`, so `../../..` is
  // `packages/` — which has no `apps/` under it, so the walk found nothing and every
  // assertion below it passed vacuously. A gate that measures nothing is the shape this
  // file's own header complains about, and it is the reason the control arm exists.
  const root = path.resolve(here, '../../../..');
  const collected: Array<{ name: string; body: string }> = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
      collected.push({
        name: path.relative(root, full).replace(/\\/g, '/'),
        body: readFileSync(full, 'utf8'),
      });
    }
  };
  for (const app of ['apps/web/src', 'packages/ui/src']) {
    const full = path.join(root, app);
    if (existsSync(full)) walk(full);
  }
  return collected;
}

/**
 * The non-colour scales, read from the stylesheet that ships them.
 *
 * **This block is the wave's whole point.** `typography.ts`, `spacing.ts`, `radii.ts`,
 * `shadows.ts` and `z-index.ts` existed, were asserted by a test, and rendered nothing:
 * the only importer was `tailwindPreset`, and `tailwindPreset` had no importer at all.
 * So `text-3xl` — the product's `h1` — compiled against whatever Tailwind ships by
 * default, and `shadows.ts` was a second copy of Tailwind's default shadow scale
 * standing beside `theme.css`'s three measured elevation steps. The assertions below
 * read the stylesheet instead, which is what makes every later wave checkable: a
 * heading's size, a panel's radius and a modal's stacking order are now properties a
 * test can contradict rather than preferences a reviewer has to hold in their head.
 */
describe('the scales the product renders from', () => {
  const text = themeScale('--text-');
  const leading = themeScale('--leading-');
  const tracking = themeScale('--tracking-');
  const radius = themeScale('--radius-');
  const zIndex = themeScale('--z-index-');

  it('states the type ladder as a ratio, rather than leaving it to be inferred', () => {
    // The ratio is a *number in the stylesheet*. A ladder whose steps are hand-tuned
    // can only be reviewed, which is what happened: `theme.test.ts:278` asserted six
    // sizes in a table nobody rendered while the product's heading was a seventh value
    // no test could see.
    const declared = themeScale('--automate-type-').get('--automate-type-ratio');
    if (declared === undefined) {
      throw new Error(
        'theme.css does not declare --automate-type-ratio, so the relationship between ' +
          'the sizes is implied rather than stated. That is the defect this assertion exists for.',
      );
    }
    const ratio = Number(declared);
    expect(Number.isFinite(ratio), `--automate-type-ratio is "${declared}"`).toBe(true);
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.35);
  });

  it.each(LADDER_STEPS)('puts %s one declared ratio above the step below it', (step) => {
    const ratio = Number(themeScale('--automate-type-').get('--automate-type-ratio'));
    const base = rem('--text-base', text);
    const position = LADDER_STEPS.indexOf(step);
    const expected = base * Math.pow(ratio, position);
    const measured = rem(`--text-${step}`, text);
    expect(
      Math.abs(measured - expected) / expected,
      `--text-${step} is ${String(measured)}rem and the ladder says it should be ` +
        `${expected.toFixed(4)}rem (base ${String(base)}rem x ${String(ratio)}^${String(position)})`,
    ).toBeLessThan(0.005);
  });

  it('orders every size, and floors the two sub-base steps at 12px', () => {
    const sizes = TYPE_STEPS.map((step) => ({ step, size: rem(`--text-${step}`, text) }));
    for (const [index, entry] of sizes.entries()) {
      const next = sizes[index + 1];
      expect(
        next === undefined || entry.size < next.size,
        `--text-${entry.step} (${String(entry.size)}rem) is not smaller than ` +
          `${next === undefined ? 'nothing' : `--text-${next.step} (${String(next.size)}rem)`}`,
      ).toBe(true);
    }
    // 12px, not 11: `xs` is a caption size and a helper-text size, and it is also the
    // floor for anything that has to survive iOS Safari's 16px input zoom rule and the
    // "rarely below 12px" guidance. `sm` is 14px — the dense-console UI size — and is
    // why the product uses it 94 times.
    for (const step of ['xs', 'sm']) {
      const px = rem(`--text-${step}`, text) * 16;
      expect(px, `--text-${step} is ${String(px)}px`).toBeGreaterThanOrEqual(12);
      expect(
        px,
        `--text-${step} is ${String(px)}px, which is body size wearing a caption's name`,
      ).toBeLessThan(16);
    }
  });

  it('gives every size a line-height, and keeps the text end at or above 1.4', () => {
    // 1.4 is the floor from the typography checklist: anything that wraps to three or
    // more lines needs it, even in a height-constrained row. `text-xs` and `text-sm`
    // carry 149 uses between them in this product — helper text, run ids, timestamps,
    // captions — and most of it wraps.
    for (const step of TYPE_STEPS) {
      const value = text.get(`--text-${step}--line-height`);
      expect(value, `--text-${step} has no declared line-height`).toBeDefined();
    }
    for (const step of TYPE_STEPS) {
      const lineHeight = Number(text.get(`--text-${step}--line-height`));
      if (rem(`--text-${step}`, text) <= rem('--text-lg', text)) {
        expect(
          lineHeight,
          `--text-${step} sits at ${String(lineHeight)}, under the 1.4 that three wrapped ` +
            'lines need',
        ).toBeGreaterThanOrEqual(1.4);
      }
    }
  });

  it('tightens headings and declares the standalone leading scale in order', () => {
    // Two claims, one block. The named scale exists because `leading-*` is what
    // components write, and a component writing an arbitrary `leading-[1.05]` is
    // writing a value the stylesheet does not own.
    for (const step of TYPE_STEPS) {
      const lineHeight = Number(text.get(`--text-${step}--line-height`));
      if (rem(`--text-${step}`, text) >= rem('--text-3xl', text)) {
        expect(
          lineHeight,
          `--text-${step} is a display size and sits at ${String(lineHeight)}, where a ` +
            'wrapped heading collides its own second line',
        ).toBeLessThanOrEqual(1.2);
      }
    }
    const values = LEADING_STEPS.map((step) => Number(leading.get(`--leading-${step}`)));
    for (const value of values) expect(Number.isFinite(value)).toBe(true);
    for (const [index, value] of values.entries()) {
      const next = values[index + 1];
      if (next === undefined) continue;
      expect(
        value,
        `--leading-${LEADING_STEPS[index]} (${String(value)}) is not below ` +
          `--leading-${LEADING_STEPS[index + 1]} (${String(next)})`,
      ).toBeLessThan(next);
    }
  });

  it('declares a letter-spacing scale that closes up large and opens up small', () => {
    // The sign is the rule, not the magnitude: a display size at positive tracking
    // reads loose and a 12px uppercase label at negative tracking reads crowded. So
    // `normal` is the hinge and the assertion is on the sides of it.
    const values = TRACKING_STEPS.map((step) => {
      const raw = tracking.get(`--tracking-${step}`);
      expect(raw, `theme.css does not declare --tracking-${step}`).toBeDefined();
      const match = /^(-?[\d.]+)em$/.exec(raw ?? '');
      if (match?.[1] === undefined) {
        throw new Error(`--tracking-${step} is "${String(raw)}", which is not an em length`);
      }
      return { step, em: Number(match[1]) };
    });
    for (const [index, entry] of values.entries()) {
      const next = values[index + 1];
      if (next === undefined) continue;
      expect(
        entry.em,
        `--tracking-${entry.step} (${String(entry.em)}em) is not below ` +
          `--tracking-${next.step} (${String(next.em)}em)`,
      ).toBeLessThan(next.em);
    }
    for (const entry of values) {
      if (entry.step === 'tighter' || entry.step === 'tight') {
        expect(entry.em, `--tracking-${entry.step} is not negative`).toBeLessThan(0);
      }
      if (entry.step === 'wide' || entry.step === 'wider' || entry.step === 'widest') {
        expect(entry.em, `--tracking-${entry.step} is not positive`).toBeGreaterThan(0);
      }
      if (entry.step === 'normal') expect(entry.em).toBe(0);
    }
  });

  it('declares the spacing base unit, and declares it in rem', () => {
    // 0.25rem is a 4px base with the 8px rhythm living in the even multiples. A bare
    // number here is not a unit and cannot be asserted.
    const declared = themeValue('--spacing');
    expect(declared, 'theme.css does not declare --spacing').toBe('0.25rem');
  });

  it('declares the radius scale in order, and keeps the panel radius under the glass ceiling', () => {
    const pixels = RADIUS_STEPS.map((step) => {
      const raw = radius.get(`--radius-${step}`);
      if (raw === undefined) throw new Error(`theme.css does not declare --radius-${step}`);
      const match = /^(-?[\d.]+)(px|rem)$/.exec(raw);
      if (match?.[1] === undefined || match[2] === undefined) {
        throw new Error(`--radius-${step} is "${raw}", which is not a length`);
      }
      return { step, px: Number(match[1]) * (match[2] === 'rem' ? 16 : 1) };
    });
    for (const [index, entry] of pixels.entries()) {
      const next = pixels[index + 1];
      if (next === undefined || next.step === 'full') continue;
      expect(
        entry.px,
        `--radius-${entry.step} (${String(entry.px)}px) is not smaller than ` +
          `--radius-${next.step} (${String(next.px)}px)`,
      ).toBeLessThan(next.px);
    }
    // The cross-check with the other authority. `--automate-glass-radius` is a 12px
    // *ceiling* on the radius of a panel that has a translucent fill, and `xl` is the
    // largest radius a panel uses. If `xl` grew past the ceiling, every glass surface
    // would be rounding its own content, and the two numbers would disagree silently
    // because they live in different files.
    const xl = pixels.find((entry) => entry.step === 'xl');
    expect(
      xl?.px,
      `--radius-xl (${String(xl?.px)}px) is past the glass radius ceiling of ` +
        `${String(GLASS_MAX_RADIUS_PX)}px`,
    ).toBeLessThanOrEqual(GLASS_MAX_RADIUS_PX);
  });

  it('names every stacking step, so no component has to know the numbers', () => {
    // `z-50` and `z-10` were in six components and neither said what it was for. The
    // numbers are not the decision; "toast above a modal" is. Both directions are
    // asserted — the scale is declared, and nothing may write a bare number.
    const values = Z_INDEX_STEPS.map((step) => {
      const raw = zIndex.get(`--z-index-${step}`);
      if (raw === undefined) throw new Error(`theme.css does not declare --z-index-${step}`);
      return { step, value: Number(raw) };
    });
    for (const value of values) expect(Number.isFinite(value.value)).toBe(true);
    for (const [index, entry] of values.entries()) {
      const next = values[index + 1];
      if (next === undefined) continue;
      expect(
        entry.value,
        `--z-index-${entry.step} (${String(entry.value)}) is not below ` +
          `--z-index-${next.step} (${String(next.value)})`,
      ).toBeLessThan(next.value);
    }
  });

  it('publishes the two families as Tailwind font utilities, not only as custom properties', () => {
    // `--automate-font-sans` and `--automate-font-mono` were declared in `fonts.css`
    // and read by `body`, so nothing inherited the wrong face — but `font-mono` was
    // Tailwind's *default* mono stack, which on Windows resolves to Consolas. Every
    // `font-mono` in this product — the run id, the digest, the score — was therefore
    // rendering in the operating system's face rather than the committed one, in a
    // product whose thesis is that evidence is set in JetBrains Mono.
    //
    // The two `@theme inline` declarations are what make the utility name the same
    // decision `body` makes, and `inline` is required: it substitutes the `var()`
    // rather than emitting a variable that points at another variable.
    const fontsCss = readFileSync(path.join(here, 'fonts.css'), 'utf8');
    for (const [utility, variable] of [
      ['--font-sans', '--automate-font-sans'],
      ['--font-mono', '--automate-font-mono'],
    ]) {
      expect(
        fontsCss,
        `fonts.css does not publish ${utility}, so ${utility} resolves to Tailwind's ` +
          `default rather than to ${variable}`,
      ).toMatch(new RegExp(`${utility}\\s*:\\s*var\\(${variable}\\)`));
    }
    // And the property they name has to exist, or the utility points at nothing.
    for (const variable of ['--automate-font-sans', '--automate-font-mono']) {
      expect(
        new RegExp(`${variable.replace(/-/g, '\\-')}\\s*:\\s*[^;]+;`).test(fontsCss),
        `fonts.css does not define ${variable}`,
      ).toBe(true);
    }
  });

  it('publishes a measure for prose and states that data is not prose', () => {
    // 68ch, not Tailwind's `max-w-prose` and not the 60ch the swiss checklist asks
    // for: the product's prose is a paragraph of explanation next to an instrument, and
    // it runs a little wider than a magazine column because it is not being read as
    // continuous text. It is a *ceiling on prose only*, which is why the value is a
    // named utility rather than a `max-w-*` on a container.
    const declared = themeScale('--max-w-').get('--max-w-measure');
    expect(declared, 'theme.css does not declare --max-w-measure').toBe('68ch');
  });
});

/**
 * The body of a `@media` block, found by brace-matching from the at-rule.
 *
 * Brace-matching rather than a regex up to the first `}`, because these blocks
 * contain nested selector lists with their own braces — a regex that stopped at
 * the first `}` would assert against half the rule and pass.
 */
function mediaBody(atRule: string): string {
  const start = themeCss.indexOf(atRule);
  if (start === -1) throw new Error(`theme.css emits no ${atRule} rule`);
  const open = themeCss.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < themeCss.length; index += 1) {
    if (themeCss[index] === '{') depth += 1;
    else if (themeCss[index] === '}') {
      depth -= 1;
      if (depth === 0) return themeCss.slice(open + 1, index);
    }
  }
  throw new Error(`the ${atRule} rule in theme.css is never closed`);
}

/**
 * The `--automate-*` a selector declares inside an at-rule.
 *
 * Found by selector rather than by source text, for the reason `themeBlock`
 * above gives: the stylesheet goes through Prettier, which collapses a
 * selector list onto two lines with single quotes, and matching the exact
 * source would fail on a formatting pass rather than on a token.
 *
 * At module scope rather than inside the escape-hatch `describe` it grew up in,
 * because the glass assertions below read the same blocks and a second copy of a
 * brace-matcher is a second thing to keep correct.
 */
function declaredIn(atRule: string, selector: string): Map<string, string> {
  const body = mediaBody(atRule);
  const wanted = normalise(selector).split(',').map(normalise);
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors, declarations] = match;
    if (selectors === undefined || declarations === undefined) continue;
    const each = selectors.split(',').map(normalise).filter(Boolean);
    if (!each.every((part) => wanted.includes(part))) continue;
    const declared = new Map<string, string>();
    for (const entry of declarations.matchAll(/(--automate-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      const name = entry[1];
      const value = entry[2];
      if (name !== undefined && value !== undefined) declared.set(name, value.trim());
    }
    return declared;
  }
  throw new Error(`${atRule} has no block for ${selector}`);
}

const TRANSPARENCY = '@media (prefers-reduced-transparency: reduce)';
const MORE_CONTRAST = '@media (prefers-contrast: more)';
const FORCED = '@media (forced-colors: active)';
const PLANE = [
  '--automate-surface-sunken',
  '--automate-surface',
  '--automate-surface-raised',
  '--automate-surface-muted',
];

describe('design token source', () => {
  it('exports the token groups consumers index into', () => {
    // **Two, and that is the fix.** This used to assert seven — `colors`, `motion`,
    // `radii`, `shadows`, `spacing`, `typography`, `zIndex` — over five tables whose
    // only importer was this assertion. `tailwindPreset` built from them had no
    // importer anywhere in the repository, so `text-3xl` (the cockpit's `h1`)
    // compiled against Tailwind's default scale rather than any declared one, and
    // `shadows.ts` was a second copy of Tailwind's default shadow scale beside
    // `theme.css`'s measured `--shadow-elevation-1..3`.
    //
    // `colors` and `motion` survive because they have readers: `theme.test.ts` and
    // `motion.test.ts` import them directly, and both assert against the stylesheet
    // the values ship in. The five that had neither are gone, and their scales are
    // asserted from `theme.css` below instead.
    expect(Object.keys(tokens).sort()).toEqual(['colors', 'motion']);
  });

  it('defines an 11-step ramp for every hue', () => {
    expect(Object.keys(ramps).length).toBeGreaterThan(0);
    for (const [name, ramp] of Object.entries(ramps)) {
      const steps = Object.keys(ramp);
      // Guards against the previous `toBeDefined()` check, which passed for `{}`.
      expect(steps, `ramp ${name} is empty`).toHaveLength(11);
      for (const step of steps) {
        const value: string | undefined = (ramp as Record<string, string>)[step];
        expect(value, `ramp ${name} step ${step} is missing`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('defines the motion token group with real values', () => {
    expect(Object.keys(tokens.motion.duration).length).toBeGreaterThan(1);
    expect(Object.keys(tokens.motion.easing).length).toBeGreaterThan(1);
  });

  it('has no tailwind preset to keep in step with the stylesheet', () => {
    // `tailwindPreset` was the whole reason the five tables were reachable: a preset
    // is a *second* Tailwind theme, and a second Tailwind theme in a repository whose
    // landed decision is "CSS stays the single token authority, no build step" is the
    // defect `no-second-authority` exists to prevent. Asserted over the files rather
    // than over an import, because an export nobody imports still imports fine — the
    // previous `tokens` object was exactly that, and it took four waves to notice.
    const offenders = tokenSourceFiles().filter((file) => /tailwindPreset/.test(file.body));
    expect(
      offenders.map((file) => file.name),
      'a second Tailwind theme is back in the tokens directory beside the stylesheet that owns it',
    ).toEqual([]);
  });

  it('declares every semantic colour name in the shipped theme', () => {
    const declared = declaredColorNames(themeCss);
    for (const name of Object.keys(semanticColorTokens)) {
      expect(declared, `theme.css does not declare --color-${name}`).toContain(name);
    }
  });

  it('maps every declared colour name onto a variable the theme defines', () => {
    const defined = definedVariableNames(themeCss);
    for (const match of themeCss.matchAll(
      /--color-[a-z0-9-]+\s*:\s*var\((--automate-[a-z0-9-]+)\)/g,
    )) {
      expect(defined, `theme.css maps onto the undefined ${match[1]}`).toContain(match[1]);
    }
  });

  it('points every semantic token at a variable the theme actually defines', () => {
    const defined = definedVariableNames(themeCss);
    for (const [name, variable] of Object.entries(semanticColorTokens)) {
      expect(defined, `${name} points at undefined ${variable}`).toContain(variable);
    }
  });

  it('defines a value for every semantic token in both themes', () => {
    for (const selector of BOTH_SELECTORS) {
      for (const variable of new Set(Object.values(semanticColorTokens))) {
        expect(variableValue(selector, variable), `${variable} in ${selector}`).toMatch(
          /^#[0-9a-f]{6}$/i,
        );
      }
    }
  });

  it('keeps only Tailwind built-ins outside the theme', () => {
    const declared = declaredColorNames(themeCss);
    /**
     * `--color-glass` is the one `--color-*` that is not a semantic colour token, and it
     * is excluded here rather than added to `semanticColorTokens` for a concrete reason:
     * every name in that table must be a literal `#rrggbb` **declared in both theme
     * blocks**, which is what `defines a value for every semantic token in both themes`
     * above checks. The glass fill is neither — it is `color-mix(... transparent)` against
     * `--automate-surface`, declared once in `:root` because the mix resolves against
     * whichever surface the theme has in force. Putting it in the table would have meant
     * either restating it per theme or weakening a test that is right about the other
     * thirty names.
     *
     * So the exception is one named entry with the reason attached, rather than a
     * pattern that would quietly admit any future derived colour.
     */
    const DERIVED_FILLS = ['glass'];
    for (const name of declared) {
      expect(
        Object.keys(semanticColorTokens).includes(name) ||
          DERIVED_FILLS.includes(name) ||
          (builtInColorNames as readonly string[]).includes(name),
        `--color-${name} is neither a semantic token, a declared derived fill, nor a Tailwind built-in`,
      ).toBe(true);
    }
  });

  describe('contrast in the theme that actually ships', () => {
    it.each(BOTH_SELECTORS)('meets 4.5:1 for foreground on surface in %s', (selector) => {
      const ratio = contrastRatio(
        variableValue(selector, '--automate-fg'),
        variableValue(selector, '--automate-surface'),
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it.each(BOTH_SELECTORS)(
      'meets 3:1 for danger against surface in %s, because it backs the destructive button',
      (selector) => {
        const ratio = contrastRatio(
          variableValue(selector, '--automate-danger'),
          variableValue(selector, '--automate-surface'),
        );
        expect(ratio).toBeGreaterThanOrEqual(3);
      },
    );

    /**
     * The remaining text tokens, against the background each one is actually
     * painted on.
     *
     * These four were the untested half of the palette. `--automate-fg-muted` is
     * what `text-fg-muted` and `text-text-secondary`/`text-text-muted` resolve
     * to, and it backs the run id, the timestamps, the helper text and every
     * empty-state description in the product — all of them text, and therefore
     * held to 4.5:1, not the 3:1 that applies to large text and UI edges.
     *
     * `--automate-accent` is the token behind `text-primary` (link and button
     * text) and `border-focus`. As *text* it needs 4.5:1; as a focus ring it
     * needs 3:1 against the adjacent colour, which is why it is checked against
     * both backgrounds rather than only the lighter one.
     */
    it.each(BOTH_SELECTORS)('meets 4.5:1 for muted text on both surfaces in %s', (selector) => {
      for (const background of ['--automate-surface', '--automate-surface-muted']) {
        const ratio = contrastRatio(
          variableValue(selector, '--automate-fg-muted'),
          variableValue(selector, background),
        );
        expect(
          ratio,
          `--automate-fg-muted on ${background} in ${selector} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    /**
     * `text-secondary` and `text-muted` are not variables of their own — they are
     * Tailwind colour names the theme maps onto `--automate-fg-muted`. Asserting
     * that mapping exists is what stops `--automate-text-secondary` and
     * `--automate-text-muted` from silently becoming untested names, since the
     * contrast numbers above are the only ones that cover them.
     */
    it('resolves the secondary and muted text names onto the tested token', () => {
      expect(semanticColorTokens['text-secondary']).toBe('--automate-fg-muted');
      expect(semanticColorTokens['text-muted']).toBe('--automate-fg-muted');
    });

    it.each(BOTH_SELECTORS)(
      'meets 4.5:1 for accent text on surface in %s, because it backs link and button text',
      (selector) => {
        const ratio = contrastRatio(
          variableValue(selector, '--automate-accent'),
          variableValue(selector, '--automate-surface'),
        );
        expect(ratio, `--automate-accent on surface in ${selector}`).toBeGreaterThanOrEqual(4.5);
      },
    );

    it.each(BOTH_SELECTORS)(
      'meets 3:1 for accent against both surfaces in %s, because it backs the focus ring',
      (selector) => {
        for (const background of ['--automate-surface', '--automate-surface-muted']) {
          const ratio = contrastRatio(
            variableValue(selector, '--automate-accent'),
            variableValue(selector, background),
          );
          expect(
            ratio,
            `--automate-accent on ${background} in ${selector} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(3);
        }
      },
    );

    /**
     * The status colours.
     *
     * `success`, `warning` and `danger` are each used two ways: as text (a badge
     * label, an alert body) and as a large swatch or border (the `Alert` tint,
     * the `StatCard` trend). Text is 4.5:1; the swatch is 3:1. The tint variants
     * paint the colour over a 10%-opacity background whose *effective* colour is a
     * blend of the token and the surface, so that is what the ratio is computed
     * against — measuring the pure token against the pure surface would be
     * measuring a colour the product never renders.
     */
    it.each(BOTH_SELECTORS)(
      'meets 3:1 for the status colours against surface in %s, because they back borders and swatches',
      (selector) => {
        for (const token of ['--automate-success', '--automate-warning', '--automate-danger']) {
          const ratio = contrastRatio(
            variableValue(selector, token),
            variableValue(selector, '--automate-surface'),
          );
          expect(
            ratio,
            `${token} on surface in ${selector} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(3);
        }
      },
    );

    it.each(BOTH_SELECTORS)(
      'meets 4.5:1 for success and warning as text on surface in %s',
      (selector) => {
        for (const token of ['--automate-success', '--automate-warning']) {
          const ratio = contrastRatio(
            variableValue(selector, token),
            variableValue(selector, '--automate-surface'),
          );
          expect(
            ratio,
            `${token} as text on surface in ${selector} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      },
    );

    /**
     * `Alert` and `Toast` render `text-warning` on `bg-warning/10`, and
     * `text-success` on `bg-success/10`. That pairing has to be measured as the
     * blend it produces, because the 10% tint raises the background luminance and
     * *lowers* the contrast — a ratio computed against the untinted surface would
     * pass while the shipped rendering failed.
     */
    it.each(BOTH_SELECTORS)(
      'meets 4.5:1 for a status colour on its own 10% tint in %s',
      (selector) => {
        for (const token of ['--automate-success', '--automate-warning', '--automate-danger']) {
          const tint = blend(
            variableValue(selector, token),
            variableValue(selector, '--automate-surface'),
            0.1,
          );
          const ratio = contrastRatio(variableValue(selector, token), tint);
          expect(
            ratio,
            `${token} on its 10% tint in ${selector} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      },
    );

    /**
     * Text painted on a saturated fill: the primary button, the destructive
     * button, the filled badge.
     *
     * This pairing is why `--automate-on-fill` exists. It cannot be expressed
     * against `--automate-fg`, because the two palettes need opposite answers:
     * the dark fills are light, so white on `--automate-accent` measures 3.68:1,
     * and the light fills are dark, so `--automate-fg` on `--automate-success`
     * measured 6.04:1 before the status tokens were darkened and 2.79:1 after.
     * One hardcoded value cannot be right for both.
     */
    it.each(BOTH_SELECTORS)(
      'meets 4.5:1 for the on-fill foreground on every filled surface in %s',
      (selector) => {
        for (const fill of [
          '--automate-accent',
          '--automate-success',
          '--automate-warning',
          '--automate-danger',
        ]) {
          const ratio = contrastRatio(
            variableValue(selector, '--automate-on-fill'),
            variableValue(selector, fill),
          );
          expect(
            ratio,
            `--automate-on-fill on ${fill} in ${selector} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      },
    );

    /**
     * `--automate-border` is deliberately *not* asserted here.
     *
     * It measures 1.31:1 in dark and 1.27:1 in light, which is below the 3:1 of
     * WCAG 1.4.11 for "visual information required to identify a control". Most
     * of what this token draws is decoration — a card edge, a divider — where
     * 1.4.11 does not apply, but the `Input`, `Select` and `Textarea` borders are
     * the only thing delineating those controls, so the token does owe 3:1. That
     * is a whole-palette decision, not a token test, and re-tuning it here would
     * change the surface treatment of the entire product on the strength of an
     * assertion nobody asked for. It is recorded here so the gap is not lost.
     */
    it('records the border ratio in both themes, because it does not meet 3:1', () => {
      const measured = BOTH_SELECTORS.map((selector) =>
        contrastRatio(
          variableValue(selector, '--automate-border'),
          variableValue(selector, '--automate-surface'),
        ),
      );
      // A reminder, not a gate: flip this assertion to `toBeGreaterThanOrEqual(3)`
      // when the border ramp is re-tuned, and delete this comment with it.
      expect(measured.every((ratio) => ratio < 3)).toBe(true);
    });
  });

  /**
/**
   * The plane.
   *
   * Four steps (D6-1), and the property worth asserting is not any individual
   * ratio — it is the *order*. A surface gets lighter as it rises in dark mode
   * and closer to white in light mode, and that ordering is what makes "raised"
   * mean something: a component that picks `bg-surface-raised` is picking a step
   * unambiguously above `bg-surface`, and re-tuning one value cannot invert the
   * stack without this failing.
   *
   * The threshold is `> 1`, not a comfortable margin, and that is deliberate. The
   * four dark steps sit within a few percent of each other on purpose — a plane
   * whose steps are far apart stops reading as one plane — so an assertion with a
   * round number in it would be asserting that the plane has more separation than
   * the design wants. What must hold is strictness: two steps at the same
   * luminance are not two steps, and `bg-surface-raised` rendering identically to
   * `bg-surface` is precisely the failure a token test is here to catch.
   */
  describe('the plane has an order', () => {
    it('keeps the four steps distinct, with sunken behind the panels and raised between base and inset', () => {
      // Three claims, each of which is a different mistake:
      //
      //  - **`sunken` is the darkest step in both themes.** It is the page behind
      //    the panels, so if it were ever *lighter* than a panel the product would
      //    be drawing a hole where the chrome should be.
      //  - **`raised` lies strictly between the base and the inset.** A control
      //    painted on `raised` has to read as a control: at the base it is
      //    invisible, at the inset it looks like a well.
      //  - **The direction from base to inset inverts between the themes.** Dark
      //    rises with lightness, light falls toward white. If one theme's plane
      //    were a copy of the other's, the same token would mean "raised" in one
      //    and "recessed" in the other — and the names do not change with the
      //    theme, so one of them would be lying.
      for (const selector of BOTH_SELECTORS) {
        const luminance = (variable: string): number =>
          relativeLuminance(...hexChannels(variableValue(selector, variable)));
        const sunken = luminance('--automate-surface-sunken');
        const base = luminance('--automate-surface');
        const raised = luminance('--automate-surface-raised');
        const inset = luminance('--automate-surface-muted');

        for (const [name, value] of [
          ['--automate-surface', base],
          ['--automate-surface-raised', raised],
          ['--automate-surface-muted', inset],
        ] as const) {
          expect(
            value,
            `${name} (${String(value)}) is not lighter than --automate-surface-sunken ` +
              `(${String(sunken)}) in ${selector}, so the page is not behind the panels`,
          ).toBeGreaterThan(sunken);
        }
        const aboveBase = raised > base;
        expect(
          aboveBase ? inset > raised : inset < raised,
          `--automate-surface-raised (${String(raised)}) is not between --automate-surface ` +
            `(${String(base)}) and --automate-surface-muted (${String(inset)}) in ${selector}`,
        ).toBe(true);
      }

      // And the inversion itself, stated once across the pair so a single theme
      // passing its own direction cannot hide a plane copied into both.
      const direction = (selector: string): 'rising' | 'falling' =>
        relativeLuminance(...hexChannels(variableValue(selector, '--automate-surface-muted'))) >
        relativeLuminance(...hexChannels(variableValue(selector, '--automate-surface')))
          ? 'rising'
          : 'falling';
      expect(direction(DARK_SELECTOR)).toBe('rising');
      expect(direction(LIGHT_SELECTOR)).toBe('falling');
    });
  });

  /**
   * Every new token, measured against the background it is actually painted on.
   *
   * The rule this repository keeps hitting is that a token with no contrast case
   * is a token with no measured value: the assertions in this file are
   * hand-written, so adding a variable to `theme.css` does not add a number here.
   * The four plane steps and the second border arrived that way, and a token
   * nobody measured is a token nobody can tell is wrong.
   *
   * Every pair below is a real pairing in the product — a background a token is
   * painted on, or a foreground drawn on a fill — rather than a cross product of
   * every token against every surface. 4.5 for anything carrying text, 3 for
   * anything that is a border, a swatch or a focus ring.
   */
  describe('every token has a measured pair', () => {
    /**
     * The four plane steps, in the order they stack.
     */
    const PLANE = [
      '--automate-surface-sunken',
      '--automate-surface',
      '--automate-surface-raised',
      '--automate-surface-muted',
    ];

    /**
     * Every pairing that is a real surface in the product, and the minimum each one
     * owes: 4.5 wherever text is drawn, 3 for a border, a swatch or a ring.
     *
     * **A table rather than seven cases, because seven cases were the same loop with a
     * different token in it** — a repetition, and the seventh one was the only function
     * in this file whose complexity counted against the ceiling. What cannot be shared
     * is the third column: it is the statement of *where* in the product the pairing
     * occurs, and a contrast ratio without one is a number somebody chose.
     */
    const PAIRS: ReadonlyArray<readonly [string, number, string]> = [
      [
        '--automate-fg',
        4.5,
        'body text: the app shell paints `bg-surface-sunken` behind content that carries it',
      ],
      [
        '--automate-fg-muted',
        4.5,
        'the run id, the timestamps and the helper text, and the evidence panel sets them on the sunken plane',
      ],
      [
        '--automate-border-strong',
        3,
        'the only edge delineating an `Input`, a `Select`, a `Textarea` or a `Toggle` — WCAG 1.4.11',
      ],
      [
        '--automate-info',
        4.5,
        '`Alert` renders `text-info` the way it renders `text-success`, so decoupling info from the accent moved it from being measured as the accent to being measured as a status colour',
      ],
      [
        '--automate-accent',
        4.5,
        'text-primary, so it is text on every step a link can appear on rather than only the one the first draft of this suite happened to name',
      ],
    ];

    it.each(BOTH_SELECTORS)(
      'meets its stated minimum on every plane step it is painted on, in %s',
      (selector) => {
        for (const [variable, minimum, pairing] of PAIRS) {
          const foreground = variableValue(selector, variable);
          for (const background of PLANE) {
            expectAtLeast(
              contrastRatio(foreground, variableValue(selector, background)),
              minimum,
              `${variable} on ${background} in ${selector} — ${pairing}`,
            );
          }
        }
      },
    );

    it.each(BOTH_SELECTORS)(
      'meets 4.5:1 for every status colour on its own 10% tint, over the base and the raised step, in %s',
      (selector) => {
        // The tint raises the background luminance and *lowers* the contrast, so a
        // ratio computed against the untinted surface passes while the shipped
        // rendering fails. Both steps are checked because an `Alert` on a `Card` is a
        // real pairing and a card's surface is the raised step.
        const status = [
          '--automate-success',
          '--automate-warning',
          '--automate-danger',
          '--automate-info',
        ];
        for (const token of status) {
          for (const background of ['--automate-surface', '--automate-surface-raised']) {
            const tint = blend(
              variableValue(selector, token),
              variableValue(selector, background),
              0.1,
            );
            expectAtLeast(
              contrastRatio(variableValue(selector, token), tint),
              4.5,
              `${token} on its 10% tint over ${background} in ${selector}`,
            );
          }
        }
      },
    );
  });

  describe('the hues are the ones the decision names', () => {
    const HUES: ReadonlyArray<readonly [string, string, number]> = [
      ['accent', '--automate-accent', 253],
      ['success', '--automate-success', 148],
      ['warning', '--automate-warning', 72],
      ['danger', '--automate-danger', 25],
      ['info', '--automate-info', 258],
    ];

    /** The shortest way round the hue circle, so 253 and 3 are 10 apart. */
    function hueDistance(left: number, right: number): number {
      const difference = Math.abs(left - right);
      return Math.min(difference, 360 - difference);
    }

    it.each(BOTH_SELECTORS)(
      'lands every hue within 3 degrees of its decision in %s',
      (selector) => {
        for (const [name, variable, expected] of HUES) {
          const measured = oklch(variableValue(selector, variable)).hue;
          const distance = hueDistance(measured, expected);
          expect(
            distance,
            `${name} (${variable}) in ${selector} is at hue ${measured.toFixed(1)}, which is ` +
              `${distance.toFixed(1)} degrees from the decided ${String(expected)}`,
          ).toBeLessThanOrEqual(3);
        }
      },
    );

    it.each(BOTH_SELECTORS)('keeps info quieter than the accent in %s', (selector) => {
      const info = oklch(variableValue(selector, '--automate-info'));
      const accent = oklch(variableValue(selector, '--automate-accent'));
      // A categorical claim rather than a ratio with a magic number in it: info
      // must be under half the accent's chroma, so it reads as a note rather than
      // as a verdict, at any hue.
      expect(
        info.chroma,
        'info is as saturated as the accent, so a reader who has learned that the ' +
          'brand colour means a verdict cannot tell them apart',
      ).toBeLessThan(accent.chroma / 2);
    });

    it('keeps every pair of run states 20 degrees apart, and each clear of the accent', () => {
      // 20 degrees of OKLab hue is about where two hues stop being separable by
      // hue alone. Below it the palette is relying on saturation as well as hue,
      // which is exactly what a reader with a colour vision deficiency cannot do.
      const RUN_STATES = HUES.filter(([name]) => name !== 'info');
      for (const selector of BOTH_SELECTORS) {
        const hues = RUN_STATES.map(([name, variable]) => ({
          name,
          hue: oklch(variableValue(selector, variable ?? '')).hue,
        }));
        for (let left = 0; left < hues.length; left += 1) {
          for (let right = left + 1; right < hues.length; right += 1) {
            const a = hues[left];
            const b = hues[right];
            if (a === undefined || b === undefined) continue;
            const distance = hueDistance(a.hue, b.hue);
            expect(
              distance,
              `${a.name} and ${b.name} are ${distance.toFixed(1)} degrees apart in ${selector}`,
            ).toBeGreaterThanOrEqual(20);
          }
        }
      }
    });
  });

  /**
   * The three escape hatches, one assertion each.
   *
   * `prefers-reduced-motion` lives in `motion.css` and is asserted in
   * `motion.test.ts`; it is deliberately **not** duplicated here, because a second
   * copy of one media query is a second authority for it and this file's job is
   * the colour plane.
   *
   * Each of the other three is its own `it`, because they are three different
   * user requests with three different failure modes: one removes alpha, one
   * raises contrast, and one hands the palette to the operating system. A single
   * assertion that all three blocks exist would pass on three empty blocks.
   */
  describe('the escape hatches degrade rather than override', () => {
    /**
     * The four plane steps as they will actually be painted under an at-rule.
     *
     * The block's own declarations win over the base theme's, because a block
     * that restates a surface changes which surface the border is measured
     * against. Measuring against the base value would be the RF-9 shape: a real
     * comparison against the wrong input.
     */
    function planeUnder(atRule: string, selector: string): string[] {
      const declared = declaredIn(atRule, selector);
      return PLANE.map((variable) => declared.get(variable) ?? variableValue(selector, variable));
    }

    it('strengthens both borders under prefers-reduced-transparency', () => {
      // The glass phase does not ship, so what this media query does today is the
      // half of it that applies to a plane this dark: a user who has asked for no
      // transparency gets the two greys that carry the least information pushed
      // apart, so nothing they read sits one step from its background.
      for (const selector of BOTH_SELECTORS) {
        const declared = declaredIn(TRANSPARENCY, selector);
        const backgrounds = planeUnder(TRANSPARENCY, selector);
        for (const variable of ['--automate-border', '--automate-border-strong']) {
          const value = declared.get(variable);
          if (value === undefined) {
            throw new Error(`${TRANSPARENCY} does not name ${variable} for ${selector}`);
          }
          for (const background of backgrounds) {
            const ratio = contrastRatio(value, background);
            expect(
              ratio,
              `${variable} under reduced transparency is ${ratio.toFixed(2)}:1 on ${background} ` +
                `in ${selector}, so nothing about the plane got more legible`,
            ).toBeGreaterThanOrEqual(3);
          }
        }
      }
    });

    /**
     * A token the media query must name, or the block is not doing what it claims.
     *
     * A thrown `Error` rather than an `expect`, because a failing expectation here
     * would read "expected undefined to be a string" — the assertion that matters is
     * the one about the value, and it cannot run until this one has passed.
     *
     * @param {Map<string, string>} declared
     * @param {string} variable
     * @param {string} atRule
     * @param {string} selector
     * @returns {string}
     */
    function requireToken(
      declared: Map<string, string>,
      variable: string,
      atRule: string,
      selector: string,
    ): string {
      const value = declared.get(variable);
      if (value === undefined) {
        throw new Error(`${atRule} does not name ${variable} for ${selector}`);
      }
      return value;
    }

    it('raises muted text and both borders under prefers-contrast: more', () => {
      for (const selector of BOTH_SELECTORS) {
        const declared = declaredIn(MORE_CONTRAST, selector);
        const base = variableValue(selector, '--automate-fg-muted');
        const raised = requireToken(declared, '--automate-fg-muted', MORE_CONTRAST, selector);

        // Toward the full foreground in both themes: up in dark, down in light.
        // A `--automate-fg` comparison would be the wrong assertion, because the media
        // query deliberately stops short of it — the point is more contrast, not the
        // maximum.
        const towardFg =
          relativeLuminance(...hexChannels(raised)) - relativeLuminance(...hexChannels(base));
        const isDark =
          relativeLuminance(...hexChannels(variableValue(selector, '--automate-fg'))) >
          relativeLuminance(...hexChannels(base));
        expect(
          isDark ? towardFg : -towardFg,
          `--automate-fg-muted under prefers-contrast: more moved away from the foreground in ${selector}`,
        ).toBeGreaterThan(0);

        // And the raised value still has to clear 4.5:1, or the media query has traded a
        // working palette for a broken one.
        for (const background of PLANE) {
          const value = declared.get(background) ?? variableValue(selector, background);
          expectAtLeast(
            contrastRatio(raised, value),
            4.5,
            `--automate-fg-muted under prefers-contrast: more on ${background} in ${selector}`,
          );
        }
        for (const variable of ['--automate-border', '--automate-border-strong']) {
          const value = requireToken(declared, variable, MORE_CONTRAST, selector);
          for (const background of PLANE) {
            expectAtLeast(
              contrastRatio(value, variableValue(selector, background)),
              3,
              `${variable} under prefers-contrast: more on ${background} in ${selector}`,
            );
          }
        }

        // The status hues and the accent are deliberately untouched: they already clear
        // 4.5:1, and pushing them further would put `--automate-on-fill` below it, which
        // fixes one contrast request by breaking a different one.
        for (const untouched of [
          '--automate-success',
          '--automate-warning',
          '--automate-danger',
          '--automate-info',
          '--automate-accent',
        ]) {
          expect(
            declared.has(untouched),
            `${MORE_CONTRAST} restates ${untouched}, which changes what sits on top of it`,
          ).toBe(false);
        }
      }
    });

    it('hands the borders and the plane to the OS under forced-colors', () => {
      // One block for both themes: in forced-colors mode the two themes are the
      // same screen, and keeping two values would be keeping a distinction the
      // user cannot see.
      const declared = declaredIn(FORCED, ":root, [data-theme='dark'], [data-theme='light']");
      expect(declared.get('--automate-border')).toBe('CanvasText');
      expect(declared.get('--automate-border-strong')).toBe('CanvasText');
      for (const surface of PLANE) {
        expect(declared.get(surface), `${surface} is not handed to the OS`).toBe('Canvas');
      }
      // `forced-color-adjust: none` anywhere in the tree would put a colour the
      // user did not choose back on screen, which is the one outcome this query
      // exists to prevent. Matched as a *declaration*, not as a word: the reason is
      // written in the comment beside this rule, and a test that matched the prose
      // would fail on its own explanation.
      expect(themeCss).not.toMatch(/forced-color-adjust\s*:/);
    });

    it('does not duplicate prefers-reduced-motion, which motion.css owns', () => {
      expect(themeCss).not.toContain('prefers-reduced-motion');
    });
  });
});

/**
 * The alpha dimension.
 *
 * **Why this block exists and what it replaced.** Glass used to be a review rule and a
 * lint ban, and the review rule's sentence — *"the pixels behind a panel in this product
 * are usually the evidence itself"* — was correct. What was wrong was the conclusion
 * drawn from it. So the concern is now answered by measurement rather than by a
 * prohibition: a panel's fill is a *composite*, and the composite has to clear 4.5:1
 * against every plane step it can be painted over, in both themes.
 *
 * The three tokens with no theme dependence — blur, saturation and the radius ceiling —
 * are declared once in `:root`, and the first case below fails if a theme block starts
 * restating them. One value, one place.
 */
describe('the alpha dimension glass adds to the plane', () => {
  const EFFECT = [
    '--automate-glass-fill',
    '--automate-glass-blur',
    '--automate-glass-saturate',
    '--automate-glass-radius',
  ];

  /** The declared fill, as a percentage. Throws rather than defaulting to something. */
  function fillPercent(): number {
    const value = variableValue(DARK_SELECTOR, '--automate-glass-fill');
    const match =
      /^color-mix\(in oklab,\s*var\(--automate-surface\)\s*([\d.]+)%\s*,\s*transparent\)$/.exec(
        value,
      );
    if (match?.[1] === undefined) {
      throw new Error(
        `--automate-glass-fill is "${value}", which is not the plane at a declared alpha. ` +
          'The contrast case below needs to know the alpha to compute a composite, so an ' +
          'unparseable fill is a failure rather than a default.',
      );
    }
    return Number(match[1]);
  }

  it('keeps the fill at or above the floor, and short of opaque', () => {
    const percent = fillPercent();
    expect(
      percent,
      `--automate-glass-fill is ${String(percent)}%, below the floor of ` +
        `${String(GLASS_MIN_FILL_PERCENT)}%. Below the floor the contrast against the ` +
        'worst-case backdrop stops being measurable, so §3.3 has nothing to compute.',
    ).toBeGreaterThanOrEqual(GLASS_MIN_FILL_PERCENT);
    expect(
      percent,
      '--automate-glass-fill is fully opaque, which is not an effect at all',
    ).toBeLessThan(100);
  });

  it('declares the effect once, in :root, and not per theme', () => {
    const light = themeBlock(LIGHT_SELECTOR);
    for (const variable of EFFECT) {
      expect(
        new RegExp(`${variable}\\s*:`).test(light),
        `${variable} is restated in the light theme. None of the four depends on the theme — ` +
          'the fill is a `color-mix` against `--automate-surface`, which the light block ' +
          'redefines — and two copies is one value with two homes.',
      ).toBe(false);
      expect(
        variableValue(DARK_SELECTOR, variable),
        `theme.css does not define ${variable} in :root`,
      ).not.toBe('');
    }
  });

  it('sits at or below the ceiling of both scheduled ranges', () => {
    const blur = variableValue(DARK_SELECTOR, '--automate-glass-blur');
    const pixels = Number(/^([\d.]+)px$/.exec(blur)?.[1]);
    expect(Number.isFinite(pixels), `--automate-glass-blur is "${blur}", not a px length`).toBe(
      true,
    );
    expect(pixels).toBeGreaterThanOrEqual(GLASS_BLUR_PX.floor);
    expect(
      pixels,
      'the upper half of the 8–16px range waits on a rendering measurement',
    ).toBeLessThanOrEqual(GLASS_BLUR_PX.ceiling);

    const saturate = Number(variableValue(DARK_SELECTOR, '--automate-glass-saturate'));
    expect(Number.isFinite(saturate), 'the saturation is not a number').toBe(true);
    expect(saturate).toBeGreaterThanOrEqual(GLASS_SATURATE.floor);
    expect(
      saturate,
      'the upper half of the 1.05–1.15 range waits on a measurement',
    ).toBeLessThanOrEqual(GLASS_SATURATE.ceiling);
    expect(saturate, 'a saturation at or below 1 is not an effect at all').toBeGreaterThan(1);

    const radius = variableValue(DARK_SELECTOR, '--automate-glass-radius');
    const radiusPx = Number(/^([\d.]+)px$/.exec(radius)?.[1]);
    expect(
      Number.isFinite(radiusPx),
      `--automate-glass-radius is "${radius}", not a px length`,
    ).toBe(true);
    expect(
      radiusPx,
      "the radius is a ceiling: past a panel's own content it starts rounding the data " +
        'inside it',
    ).toBeLessThanOrEqual(GLASS_MAX_RADIUS_PX);
  });

  /**
   * The case the design language could not state before there was an alpha.
   *
   * A panel over a static plane samples a fixed set of pixels and its contrast is a
   * property of the theme. A translucent panel does not: it samples whatever is behind
   * it, so the background it actually paints text on is a *composite* of the fill and
   * the plane. A panel that passes against `--automate-surface` and fails against
   * `--automate-surface-sunken` is legible on one screen and not on another, and no
   * assertion that reads a single token can see it.
   *
   * All four plane steps are checked rather than the two extremes, because the set is
   * four values long and checking all of them is both simpler and strictly stronger.
   */
  it.each(BOTH_SELECTORS)(
    'holds text at 4.5:1 against every plane step behind it in %s',
    (selector) => {
      const alpha = fillPercent() / 100;
      const surface = variableValue(selector, '--automate-surface');
      for (const backdrop of PLANE) {
        const painted = blend(surface, variableValue(selector, backdrop), alpha);
        for (const text of ['--automate-fg', '--automate-fg-muted']) {
          expectAtLeast(
            contrastRatio(variableValue(selector, text), painted),
            4.5,
            `${text} on a glass panel over ${backdrop} in ${selector}`,
          );
        }
      }
    },
  );

  /**
   * The hues, which are the harder half.
   *
   * `StatCard` draws its trend in `--automate-success` or `--automate-danger` on a glass
   * fill, and those are the two values a reader is least able to give up: a trend is a
   * claim, and it is read at a glance. Checking only `--automate-fg` and
   * `--automate-fg-muted` would have let a hue that was measured against four *opaque*
   * plane steps meet a translucent one without ever being recomputed — which is the same
   * mistake as the one the whole block exists to fix, one layer down.
   *
   * `--automate-accent` is here for the same reason as `Card`'s border: a focus ring and
   * an accent link are both text-adjacent colours on a panel.
   */
  it.each(BOTH_SELECTORS)(
    'holds the status and accent hues at 4.5:1 on a glass panel in %s',
    (selector) => {
      const alpha = fillPercent() / 100;
      const surface = variableValue(selector, '--automate-surface');
      for (const hue of [
        '--automate-success',
        '--automate-warning',
        '--automate-danger',
        '--automate-info',
        '--automate-accent',
      ]) {
        for (const backdrop of PLANE) {
          const painted = blend(surface, variableValue(selector, backdrop), alpha);
          expectAtLeast(
            contrastRatio(variableValue(selector, hue), painted),
            4.5,
            `${hue} on a glass panel over ${backdrop} in ${selector}`,
          );
        }
      }
    },
  );

  it('has no border token, because a fixed alpha cannot describe the edge', () => {
    // The two-border rule says WCAG 1.4.11 applies to some borders and not to others.
    // A glass border's job is to describe the panel's edge against whatever is behind
    // it, so it is a function of the backdrop rather than a colour — a 1px hairline at
    // a fixed alpha is invisible on a light backdrop and a hard line on a dark one. The
    // edge is described by elevation instead, and that is what `shadow-glass` is.
    expect(themeCss).not.toMatch(/--automate-glass-border/);
    expect(themeCss).toMatch(/--shadow-glass:/);
  });

  it('exposes each glass token to Tailwind as exactly one utility', () => {
    const theme = themeCss.match(/@theme inline\s*\{([^{}]*)\}/)?.[1] ?? '';
    // Matched as *declarations*, not as words. The block above explains why there is no
    // `--radius-glass`, and a test that matched the prose would fail on its own
    // explanation — which is the trap the file's earlier assertions about
    // `forced-color-adjust` already record.
    for (const name of ['--color-glass', '--backdrop-blur-glass', '--backdrop-saturate-glass']) {
      expect(theme, `theme.css does not declare ${name} in @theme inline`).toMatch(
        new RegExp(`${name}\\s*:`),
      );
    }
    // `--shadow-glass` is a literal rather than a reference, so it belongs to the
    // `@theme` block beside the other three elevation steps.
    expect(themeCss).toMatch(/@theme\s*\{[^}]*--shadow-glass\s*:/s);

    // And the ceiling is *not* a utility. `--automate-glass-radius` is a limit a panel
    // must stay under, not a value to apply: `rounded-md`/`rounded-lg`/`rounded-xl` are
    // 6/8/12px and every surface that adopts glass is already inside it, so a
    // `rounded-glass` utility would only be a way to flatten the radius scale.
    expect(
      theme,
      'a radius ceiling exposed as a utility is a default wearing a limit as a name',
    ).not.toMatch(/--radius-glass\s*:/);
  });

  it('hands a reader who asked for no transparency an opaque panel and no effect', () => {
    for (const selector of BOTH_SELECTORS) {
      const declared = declaredIn(TRANSPARENCY, selector);
      const fill = declared.get('--automate-glass-fill');
      if (fill === undefined) {
        throw new Error(`${TRANSPARENCY} does not name --automate-glass-fill for ${selector}`);
      }
      expect(
        fill,
        `${TRANSPARENCY} left the fill at "${fill}" in ${selector}. The fallback has to be ` +
          'opaque: a fill that is still translucent over a backdrop the reader cannot ' +
          'predict is the thing they asked not to have.',
      ).toBe('var(--automate-surface)');

      for (const [variable, inert] of [
        ['--automate-glass-blur', '0px'],
        ['--automate-glass-saturate', '1'],
      ] as const) {
        expect(
          declared.get(variable),
          `${TRANSPARENCY} does not neutralise ${variable} for ${selector}`,
        ).toBe(inert);
      }
    }
  });
});

describe('the page wash stays out of the evidence regions', () => {
  /**
   * The exclusion, stated as a number.
   *
   * The wash is `--automate-accent` at 14% in a radial and 5% in a linear, over
   * `--automate-surface-sunken`. The strongest any pixel can be tinted is therefore the
   * plane composited with 14% of the accent — so that composite is the worst backdrop a
   * figure can sit on anywhere the wash reaches, and this block checks every status hue
   * *as text* against it, because that is how the product uses them: `text-danger`,
   * `border-danger`, `text-success` on a card, never a hue as a fill.
   *
   * **This is the assertion the plan asked for and the one that makes the wash safe.** A
   * test that only said "the wash is on the page plane" would pass the moment somebody put
   * it on a `Table`, because a reviewer's eye is exactly the thing this has to be more
   * precise than. The contrast maths already in this file — `contrastRatio`, `blend`,
   * `expectAtLeast` — is reused rather than reimplemented, so the number here is the same
   * number the plane assertions above are made of.
   */
  it('leaves every status hue legible as text on the plane the wash is painted on', () => {
    const accent = variableValue(DARK_SELECTOR, '--automate-accent');
    const hues = ['success', 'warning', 'danger', 'info', 'accent', 'fg-muted'];
    // The two wash tints, as a fraction. Read out of the token rather than typed, so a
    // retuned wash fails here instead of being checked against a stale number.
    const tints = [
      ...(themeValueBlock('--automate-page-wash') ?? '').matchAll(
        /var\(--automate-accent\)\s+(\d+)%/g,
      ),
    ].map((match) => Number(match[1]) / 100);
    expect(
      tints.length,
      'the wash names no accent percentage, so its strongest point is unknown',
    ).toBeGreaterThan(0);
    const strongest = Math.max(...tints);

    // Only `--automate-surface` is composited. The three planes above it are opaque — which
    // is the other half of the boundary, asserted in the next case — so a card, a table and
    // a muted row all sit on their own declared colour rather than on the wash. This is
    // what "the wash is on the page plane and nowhere else" has to mean for it to be true.
    const washed = blend(accent, variableValue(DARK_SELECTOR, '--automate-surface'), strongest);
    for (const hue of hues) {
      expectAtLeast(
        contrastRatio(variableValue(DARK_SELECTOR, `--automate-${hue}`), washed),
        4.5,
        `${hue} as text on the page plane under the wash at ${String(Math.round(strongest * 100))}%`,
      );
    }
  });

  it('leaves the three planes above the page opaque, so nothing above it inherits the wash', () => {
    // The occlusion half of the exclusion. A plane at `alpha: 0.4` over a washed page is a
    // tinted surface, and every figure on it is then read against a backdrop that differs
    // from the one the plane declares — which is the defect, arriving through the other
    // door. The plane steps are opaque, so the wash cannot reach anything but the page.
    for (const step of PLANE.filter((name) => name !== '--automate-surface')) {
      const declared = variableValue(DARK_SELECTOR, step);
      expect(
        declared,
        `${step} is "${declared}", which is not an opaque colour, so it composites over the ` +
          'washed page plane and every figure on it is read against a tint rather than against ' +
          'the colour the stylesheet declares for it.',
      ).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('is declared once, on the page plane, and by a utility rather than by hand', () => {
    const token = themeValueBlock('--automate-page-wash');
    expect(token, 'theme.css does not declare --automate-page-wash').toBeDefined();
    expect(
      themeCss,
      'theme.css declares the wash without publishing `bg-page-wash`, so a component would ' +
        'have to hand-write the gradient and nothing would check it',
    ).toMatch(/@utility\s+bg-page-wash\s*\{[^}]*var\(--automate-page-wash\)/);
  });

  it('interpolates in oklab, because sRGB interpolation passes through a colour nobody chose', () => {
    // The argument for OKLCH is entirely about interpolation, so it is asserted entirely
    // about interpolation. The eleven-step ramps stay hex — see the header above — and a
    // block that claimed to be an OKLCH conversion of the palette would be asserting
    // something this product deliberately does not do.
    const token = themeValueBlock('--automate-page-wash') ?? '';
    expect(token).toContain('in oklab');
    expect(
      token,
      'the wash interpolates in sRGB, so its midpoint is darker and duller than either end',
    ).not.toMatch(/\bin\ssrgb\b/i);
  });

  it('reaches no data surface: no table, no figure, no log', () => {
    // The source-level half of the assertion above, and the half that catches the mistake
    // rather than the consequence. `bg-page-wash` appears on a shell or nowhere.
    //
    // Two shells are the page plane and both are allowed: `packages/ui`'s `AppShell`, which
    // is the layout any application composes, and `apps/web`'s, which is this product's.
    // They are named rather than pattern-matched so that a third shell, or a renamed one,
    // has to be added to this list deliberately.
    const PAGE_PLANE = new Set([
      'packages/ui/src/components/AppShell/AppShell.tsx',
      'apps/web/src/components/AppShell.tsx',
    ]);
    const offenders = webSourceFiles()
      .filter((file) => /bg-page-wash/.test(file.body))
      .map((file) => file.name)
      .filter((name) => !PAGE_PLANE.has(name));
    expect(
      offenders,
      '`bg-page-wash` is the page plane. On a table, a figure or a log it is a backdrop that ' +
        'changes across the width of a column, and two values in that column then differ by ' +
        'the wash rather than by the thing they measure.',
    ).toEqual([]);
  });
});
