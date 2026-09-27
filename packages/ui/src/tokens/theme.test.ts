import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtInColorNames, ramps, semanticColorTokens } from './colors.js';
import { tokens } from './index.js';

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

describe('design token source', () => {
  it('exports the token groups consumers index into', () => {
    expect(Object.keys(tokens).sort()).toEqual([
      'colors',
      'motion',
      'radii',
      'shadows',
      'spacing',
      'typography',
      'zIndex',
    ]);
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

  it('defines the non-colour token groups with real values', () => {
    expect(Object.keys(tokens.typography.fontFamily)).toHaveLength(2);
    expect(Object.keys(tokens.typography.fontSize)).toHaveLength(6);
    expect(Object.keys(tokens.typography.fontWeight)).toHaveLength(4);
    expect(Object.keys(tokens.spacing).length).toBeGreaterThan(4);
    expect(Object.keys(tokens.radii).length).toBeGreaterThan(2);
    expect(Object.keys(tokens.shadows).length).toBeGreaterThan(2);
    expect(Object.keys(tokens.motion.duration).length).toBeGreaterThan(1);
    expect(Object.keys(tokens.motion.easing).length).toBeGreaterThan(1);
    expect(Object.keys(tokens.zIndex).length).toBeGreaterThan(2);
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
    for (const name of declared) {
      expect(
        Object.keys(semanticColorTokens).includes(name) ||
          (builtInColorNames as readonly string[]).includes(name),
        `--color-${name} is neither a semantic token nor a Tailwind built-in`,
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
});
