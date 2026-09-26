import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';

/**
 * The check that would have caught the unstyled destructive button.
 *
 * `packages/ui` used `bg-error`, `text-error`, `border-error`, `outline-error`,
 * `text-text-muted`, `bg-brand-50`, `bg-bg-base`, `text-success-500` and
 * `text-error-500`, none of which the shipped `@theme` block declared. Tailwind
 * emitted nothing for them, so the "Cancel run" button and every error state
 * rendered unstyled — while the component tests, which assert the class
 * *string* with `toHaveClass`, stayed green.
 *
 * So: compile the stylesheet the app actually loads and assert that every
 * colour utility any component uses is generated. Asserting on compiled CSS is
 * the only assertion that can fail; asserting on a class name cannot.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const uiComponentsRoot = path.join(repoRoot, 'packages/ui/src/components');
const entryStylesheet = path.join(webRoot, 'src/index.css');
const entryDirectory = path.dirname(entryStylesheet);
const { createRequire } = await import('node:module');
const tailwindEntry = path.join(
  path.dirname(createRequire(import.meta.url).resolve('tailwindcss/package.json')),
  'index.css',
);

/**
 * Tailwind prefixes that take a theme colour as their argument. `ring-offset`
 * is deliberately absent: v4 removed the colour form of it, so
 * `ring-offset-bg-base` compiles to nothing at all.
 */
const COLOR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'outline',
  'fill',
  'stroke',
  'from',
  'to',
  'via',
  'divide',
  'decoration',
  'caret',
  'accent',
] as const;

/**
 * Utilities removed in Tailwind v4. A component using one of these renders as
 * if the class were absent, with no build error — the same failure shape as an
 * undeclared colour token.
 */
const REMOVED_IN_TAILWIND_V4 = [
  /^ring-offset-/,
  /^decoration-slice$/,
  /^bg-opacity-/,
  /^text-opacity-/,
  /^border-opacity-/,
  /^flex-grow-/, // v4 spells this `grow-*`
  /^flex-shrink-/, // v4 spells this `shrink-*`
  /^overflow-ellipsis$/,
];

/**
 * Arguments that are sizes or layout keywords, not colours. Finite and
 * auditable on purpose: a permissive filter would silently stop testing the
 * utilities it is meant to test.
 */
const NON_COLOR_ARGUMENTS = new Set([
  'none',
  'inherit',
  'current',
  'full',
  'auto',
  'center',
  'left',
  'right',
  'justify',
  'start',
  'end',
  'reverse',
  'base',
  'sm',
  'lg',
  'xs',
  '2xl',
  // Directional border widths (`border-b`), not colours.
  't',
  'b',
  'l',
  'r',
  'x',
  'y',
  's',
  'e',
]);

/** Argument shapes that are widths, not colours: `outline-offset-2`, `z-10`. */
const NON_COLOR_SHAPES = [/^offset-\d+$/, /^z-\d+$/, /^gap-\d+$/];
/**
 * A size argument: digits with an optional unit suffix.
 *
 * Written as a function rather than `/^\d+(\.\d+)?(px|rem|em)?$/`, because that
 * regex nests a quantifier inside a quantifier — `\d+` followed by an optional
 * `\.\d+` — which is the shape `security/detect-unsafe-regex` exists to catch, and
 * the rule is right to object however safe the anchoring makes it in practice.
 * `Number` has no quantifiers at all, so there is nothing to backtrack: `1.2.3`
 * is `NaN`, `0x1` is finite but rejected by the leading-character check, and the
 * empty string is excluded explicitly because `Number('') === 0`.
 */
function isSizeArgument(argument: string): boolean {
  const withoutUnit = argument.replace(/(?:px|rem|em)$/, '');
  if (withoutUnit === '') return false;
  return /^\d/.test(withoutUnit) && Number.isFinite(Number(withoutUnit));
}

/**
 * A colour name: lowercase alphanumerics in dash-separated parts.
 *
 * A hand-written loop rather than `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`. The regex
 * is actually safe — each outer iteration must consume a `-`, so the input
 * cannot be partitioned two ways — but that is a fact the rule cannot see, and
 * "it is fine" is a claim that decays. Splitting on the separator is linear,
 * obvious, and satisfies the rule.
 */
function isColorName(argument: string): boolean {
  if (!/^[a-z]/.test(argument)) return false;
  return argument
    .split('-')
    .every((part) => /^[a-z0-9]+$/.test(part));
}

const COLOR_DECLARATIONS =
  /(?:^|[;{\s])(?:color|background-color|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|outline-color|fill|stroke|caret-color|ring-color|accent-color|text-decoration-color|column-rule-color|--tw-ring-color|--tw-shadow)\s*:/;

function listSourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) found.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

function listComponentFiles(): string[] {
  return [
    ...listSourceFiles(uiComponentsRoot),
    ...listSourceFiles(path.join(webRoot, 'src')),
  ].filter((file) => /\.tsx$/.test(file));
}

/**
 * Every utility-looking class name in the component sources.
 *
 * Variant prefixes are stripped as well as kept: `focus-visible:outline-error`
 * contributed only the full token, which failed the plain-class pattern, so
 * every variant-prefixed utility — the majority of the colour utilities in this
 * codebase — was invisible to the gate. A typo inside a variant prefix would
 * have compiled to nothing without anything noticing.
 */
function collectUtilityCandidates(): string[] {
  const candidates = new Set<string>();
  for (const file of listSourceFiles(uiComponentsRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`]([a-z0-9][a-z0-9:/[\]()._%!\-\s]*)['"`]/g)) {
      const literal = match[1];
      if (!literal) continue;
      for (const token of literal.split(/\s+/)) {
        if (!/^[a-z0-9][a-z0-9:/?[\]()._%!-]*$/.test(token)) continue;
        candidates.add(token);
        // Also record the base utility behind any variant prefix.
        const base = token.split(':').pop();
        if (base !== undefined && /^[a-z][a-z0-9-]*$/.test(base)) candidates.add(base);
      }
    }
  }
  return [...candidates].sort();
}

function colorUtilities(candidates: readonly string[]): string[] {
  return candidates.filter((candidate) => {
    for (const prefix of COLOR_UTILITIES) {
      if (!candidate.startsWith(`${prefix}-`)) continue;
      const argument = candidate.slice(prefix.length + 1);
      if (argument.length === 0) continue;
      if (NON_COLOR_ARGUMENTS.has(argument)) continue;
      if (NON_COLOR_SHAPES.some((pattern) => pattern.test(argument))) continue;
      if (isSizeArgument(argument)) continue;
      if (!isColorName(argument)) continue;
      return true;
    }
    return false;
  });
}

const cached = new Map<string, string>();

async function buildCss(utilities: readonly string[], stylesheet?: string): Promise<string> {
  const key = `${utilities.join(' ')}|${stylesheet === undefined ? '' : stylesheet.length}`;
  const hit = cached.get(key);
  if (hit !== undefined) return hit;
  const compiler = await compile(stylesheet ?? readFileSync(entryStylesheet, 'utf8'), {
    base: entryDirectory,
    async loadStylesheet(id: string, base: string) {
      if (id === 'tailwindcss') {
        return {
          path: tailwindEntry,
          base: path.dirname(tailwindEntry),
          content: readFileSync(tailwindEntry, 'utf8'),
        };
      }
      const resolved = path.resolve(base, id);
      return {
        path: resolved,
        base: path.dirname(resolved),
        content: readFileSync(resolved, 'utf8'),
      };
    },
    async loadModule(
      id: string,
      base: string,
    ): Promise<{ path: string; base: string; module: Record<string, unknown> }> {
      const resolved = path.resolve(base, id);
      return { path: resolved, base: path.dirname(resolved), module: {} };
    },
  });
  const output = compiler.build([...utilities]);
  cached.set(key, output);
  return output;
}

/** Tailwind escapes these in a class selector. */
function escapeSelector(className: string): string {
  return className.replace(/[.:/[\]()!%#,+&]/g, (character) => `\\${character}`);
}

/**
 * Whether Tailwind emitted a *rule for this class* carrying a colour
 * declaration.
 *
 * Checking the whole output for any colour property is worthless: preflight
 * alone contains `color: inherit` and `background-color: transparent`, so that
 * check passes for every candidate including ones Tailwind ignored. This looks
 * up the rule whose selector names the class, then inspects that rule.
 */
function utilityIsGenerated(css: string, className: string): boolean {
  const selector = `.${escapeSelector(className)}`;
  let searchFrom = 0;
  for (;;) {
    const at = css.indexOf(selector, searchFrom);
    if (at === -1) return false;
    const after = css[at + selector.length];
    // Reject a longer class that merely starts with this one.
    if (after !== undefined && !/[\s,{:>~+)\]]/.test(after)) {
      searchFrom = at + selector.length;
      continue;
    }
    const open = css.indexOf('{', at);
    if (open === -1) return false;
    const close = css.indexOf('}', open);
    if (close === -1) return false;
    const body = css.slice(open, close);
    searchFrom = close;
    if (COLOR_DECLARATIONS.test(body)) return true;
  }
}

const allCandidates = collectUtilityCandidates();
const colorCandidates = colorUtilities(allCandidates);

/**
 * One Tailwind compile of every candidate, shared by the assertions below.
 *
 * `utilityIsGenerated` resolves the rule whose selector names the class, so a
 * single batched build answers "is this class generated?" exactly as well as 48
 * separate builds do — and 48 separate builds put ~30s of blocking compiler work
 * into this package's suite, which starved the React tests running alongside
 * it into timing out.
 */
const compiledAll = await buildCss(colorCandidates);
describe('shipped theme class resolution', () => {
  it('does not hardcode a colour instead of using a token', () => {
    const offenders: string[] = [];
    for (const file of listComponentFiles()) {
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, index) => {
        if (line.includes('theme.css')) return;
        // A hex literal or a `color: 'red'` style shorthand in a component
        // bypasses the theme, so the component ignores both light and dark.
        const hex = /#[0-9a-fA-F]{3,8}\b/.exec(line);
        if (hex) offenders.push(`${path.relative(repoRoot, file)}:${index + 1} ${hex[0]}`);
        const named =
          /(?:color|background|backgroundColor|borderColor)\s*:\s*['"](?:red|blue|green|gray|grey|white|black)['"]/.exec(
            line,
          );
        if (named) offenders.push(`${path.relative(repoRoot, file)}:${index + 1} ${named[0]}`);
      });
    }
    expect(
      offenders,
      'Hardcoded colours ignore the theme. Use a token utility, or add the ' +
        'literal to packages/ui/src/tokens/theme.css if it is a new token.',
    ).toEqual([]);
  });

  it('finds colour utilities in the component sources', () => {
    // Scanned from `packages/ui/src/components`, not the whole package: the
    // token module *names* tokens like `bg-elevated` in a way that looks like a
    // class, and those names are checked against the CSS by
    // `packages/ui/src/tokens/theme.test.ts` instead.
    expect(existsSync(uiComponentsRoot)).toBe(true);
    // A silently-empty candidate list would make every assertion below vacuous.
    expect(colorCandidates.length).toBeGreaterThanOrEqual(40);
    for (const expected of [
      'bg-error',
      'text-error',
      'text-text-muted',
      'bg-brand-50',
      'bg-bg-base',
    ]) {
      expect(colorCandidates, `${expected} was not picked up by the scanner`).toContain(expected);
    }
  });

  it('does not use utilities that Tailwind v4 removed', () => {
    const offenders = allCandidates.filter((candidate) =>
      REMOVED_IN_TAILWIND_V4.some((pattern) => pattern.test(candidate)),
    );
    expect(
      offenders,
      'These classes were removed in Tailwind v4 and compile to nothing, so the ' +
        'component renders as if they were absent.',
    ).toEqual([]);
  });

  it('proves the detector can see a missing token', async () => {
    // The whole value of this suite is that it fails when a token is absent.
    // Compiling a stylesheet with the theme import removed must be reported as
    // unresolved, otherwise every assertion below is decoration.
    // Quote-agnostic: Prettier normalises `@import '…'` and `@import "…"` to
    // single quotes, and a regex pinned to double quotes made this self-check
    // fail on a formatting pass rather than on a missing token.
    const full = readFileSync(entryStylesheet, 'utf8');
    const withoutError = full.replace(/@import\s+['"][^'"]*theme\.css['"];/, '@theme inline {};');
    expect(withoutError, 'the theme import was not found in index.css').not.toBe(full);
    const css = await buildCss(['bg-error'], withoutError);
    expect(utilityIsGenerated(css, 'bg-error')).toBe(false);
  }, 60_000);

  it('generates CSS for every colour utility the components use', () => {
    const unresolved = colorCandidates.filter(
      (candidate) => !utilityIsGenerated(compiledAll, candidate),
    );
    expect(
      unresolved,
      `Tailwind emits no colour for these classes; the components render unstyled. ` +
        `Add a --color-* entry to packages/ui/src/tokens/theme.css.`,
    ).toEqual([]);
  });

  it('generates the destructive variant, which is the "Cancel run" button', () => {
    expect(utilityIsGenerated(compiledAll, 'bg-error')).toBe(true);
    expect(compiledAll).toContain('--automate-danger');
  });

  it('generates the error-state utilities used by Input and Select', () => {
    for (const candidate of ['text-error', 'border-error', 'outline-error', 'text-error-500']) {
      expect(utilityIsGenerated(compiledAll, candidate), `${candidate} generates no colour`).toBe(
        true,
      );
    }
  });

  it('generates the muted-text, brand-shade and base-background utilities', () => {
    for (const candidate of ['text-text-muted', 'bg-brand-50', 'text-brand-700', 'bg-bg-base']) {
      expect(utilityIsGenerated(compiledAll, candidate), `${candidate} generates no colour`).toBe(
        true,
      );
    }
  });

  it('generates the numeric status-shade utilities used by StatCard', () => {
    for (const candidate of ['text-success-500', 'text-error-500']) {
      expect(utilityIsGenerated(compiledAll, candidate), `${candidate} generates no colour`).toBe(
        true,
      );
    }
  });

  it('does not mistake a longer class for a shorter one', async () => {
    // Compiled alone, so `border-border` is only present if Tailwind emitted it
    // for a reason other than being asked. `border-border` *is* used in the
    // components, so it appears in the shared batched build; this checks the
    // selector lookup itself, not the theme.
    const css = await buildCss(['border-border-default']);
    expect(utilityIsGenerated(css, 'border-border')).toBe(false);
    expect(utilityIsGenerated(css, 'border-border-default')).toBe(true);
  }, 60_000);
});
