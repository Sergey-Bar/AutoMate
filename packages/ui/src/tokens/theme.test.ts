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
  });
});
