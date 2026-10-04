import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';
import { GLASS_SURFACE_CLASSES } from '@automate/ui';

/**
 * The check that would have caught the unstyled destructive button.
 *
 * `packages/ui` used `bg-error`, `text-error`, `border-error`, `outline-error`,
 * `text-text-muted`, `bg-brand-50` and `bg-bg-base`, none of which the shipped `@theme`
 * block declared. Tailwind emitted nothing for them, so the "Cancel run" button and
 * every error state rendered unstyled — while the component tests, which assert the
 * class *string* with `toHaveClass`, stayed green.
 *
 * So: compile the stylesheet the app actually loads and assert that every colour
 * utility any component uses is generated. Asserting on compiled CSS is the only
 * assertion that can fail; asserting on a class name cannot.
 *
 * **Two more names were in that list and are not any more.** `text-success-500` and
 * `text-error-500` were aliases pointing at the same `--automate-success` and
 * `--automate-danger` variables as the plain names — a second name for one value. The
 * redesign moved `StatCard` to `text-success` / `text-danger`, which left the aliases
 * referenced by nothing, so the tokens and the assertion naming them were removed
 * rather than left as a second authority nobody reads. They are recorded here because
 * the sentence above is the only place a reader would look to ask what happened to
 * them.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const uiComponentsRoot = path.join(repoRoot, 'packages/ui/src/components');
const webSourceRoot = path.join(webRoot, 'src');
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
  /*
   * **Utilities that never existed here because no plugin was installed.**
   *
   * Sixteen class names across six components — `animate-in`, `fade-in`,
   * `fade-in-0`, `fade-in-90`, `zoom-in-95` and their `open:`-prefixed forms —
   * were written against `tailwindcss-animate`. That plugin is not a dependency
   * of this repository and there are no `@keyframes` for any of them, so every one
   * compiled to nothing: the dialog, the drawer, the palette, the popover, the
   * tooltip and the empty state appeared instantly, with their class strings
   * intact, which is why every test asserting on the class name passed.
   *
   * The utilities are now declared as `--animate-*` tokens in
   * `packages/ui/src/tokens/motion.css`, so the list here is what stops the next
   * one being written from memory. `REMOVED_IN_TAILWIND_V4` was the wrong home for
   * it — these were never in Tailwind to be removed — so they live in their own
   * list below, which is why both are checked.
   */
];

/**
 * Utilities that only exist if a plugin is installed, and none is.
 *
 * Kept apart from `REMOVED_IN_TAILWIND_V4` because the two failures are
 * different. A v4 removal is a utility that *was* in Tailwind and is not any more;
 * a plugin utility is one that was never in Tailwind at all. Both compile to
 * nothing, and both look identical in a rendered page, which is why they are
 * worth naming separately.
 */
const PLUGIN_PROVIDED_UTILITIES = [
  // `tailwindcss-animate`, not a dependency here.
  /^animate-in$/,
  /^fade-in$/,
  /^fade-out$/,
  /^fade-in-\d+$/,
  /^fade-out-\d+$/,
  /^zoom-in-\d+$/,
  /^zoom-out-\d+$/,
  /^slide-in-from-/,
  /^slide-out-to-/,
  // `tailwindcss-animate` also supplied the `tw-animate-*` CSS variables.
  /^tw-animate-/,
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
  'xl',
  'xs',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
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
 * `text-` arguments that are `text-wrap` values rather than colours.
 *
 * `text-balance` and `text-pretty` are the two declarations the typography wave added —
 * `text-wrap: balance` on a heading and `text-wrap: pretty` on a description — and both
 * read as a `text-` colour name to anything matching a prefix. Left unhandled they failed
 * this gate as "Tailwind emits no colour for these classes; the components render
 * unstyled", which is a *true-sounding* report of a false positive: the classes compile,
 * and the gate is the only thing in the repository that says otherwise.
 *
 * Named rather than matched by pattern, because the set of `text-wrap` values is short and
 * closed and a pattern would quietly admit a future `text-balance-ish` that is a colour.
 */
const NON_COLOR_TEXT_WRAP = new Set(['balance', 'pretty']);

/**
 * `border-` arguments that are a *style* rather than a colour.
 *
 * `border-dashed` is what the unmeasured state of `Meter` draws, and it read as a colour
 * name to anything matching the `border-` prefix. Left unhandled it failed this gate as
 * "Tailwind emits no colour for these classes; the components render unstyled", which is a
 * true-sounding report of a false positive: the class compiles, and it compiles to
 * `border-style: dashed`, which is what was asked for.
 *
 * The six are named rather than pattern-matched, so a future `border-*-style` addition has
 * to be added deliberately — and so `border-danger` can never be mistaken for one of them.
 */
const NON_COLOR_BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'hidden', 'none']);
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
  return argument.split('-').every((part) => /^[a-z0-9]+$/.test(part));
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
 * Comments removed, so prose cannot be read as a class name.
 *
 * The scanner looks for backticked or quoted strings, and a JSDoc block is full of
 * them: writing "no `stroke-width` to inherit" next to a component put
 * `stroke-width` into the candidate list, where it failed as an unresolvable colour
 * utility with an error message about `--color-*` entries. It is a CSS *property*,
 * and Tailwind's stroke-width utilities are `stroke-2` and `stroke-[3px]` — so there
 * was no spelling of it that would have resolved, and the only fixes available were
 * deleting the sentence or growing a deny-list of property names.
 *
 * Stripping comments first is the right of the three: it keeps the sentences, keeps
 * the deny-list small enough to read, and makes the scanner's input the code rather
 * than the file.
 *
 * Line comments first, then block comments — the reverse order would eat a `//`
 * inside a block comment's text and leave the rest of the block live. The result is
 * replaced with equivalent whitespace rather than deleted so that a line number in a
 * failure still points at the right line.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\/[^\n]*/g, (line) => ' '.repeat(line.length))
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/**
 * Every utility-looking class name in the component sources.
 *
 * **Scanned across both trees.** This used to read `packages/ui/src/components`
 * only, and `apps/web/src` was therefore unverified: zero of the app's colour
 * utilities were checked, which is why `quarantine.tsx` could render `bg-blue-600`
 * — a literal Tailwind shade that ignores both the light and the dark palette —
 * without anything noticing. The token system is only enforced where the
 * defects actually live.
 *
 * Variant prefixes are stripped as well as kept: `focus-visible:outline-error`
 * contributed only the full token, which failed the plain-class pattern, so
 * every variant-prefixed utility — the majority of the colour utilities in this
 * codebase — was invisible to the gate. A typo inside a variant prefix would
 * have compiled to nothing without anything noticing.
 *
 * `packages/ui/src/tokens` is excluded: the token module *names* tokens like
 * `bg-elevated` in a way that looks like a class, and those names are checked
 * against the CSS by `packages/ui/src/tokens/theme.test.ts` instead.
 */
function collectUtilityCandidates(): string[] {
  const candidates = new Set<string>();
  for (const root of [uiComponentsRoot, webSourceRoot]) {
    for (const file of listSourceFiles(root)) {
      const source = stripComments(readFileSync(file, 'utf8'));
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
  }
  return [...candidates].sort();
}

/**
 * Which component files take the glass composition.
 *
 * A separate walk from `collectUtilityCandidates` because that one matches *class literals*,
 * and adoption is deliberately not a class literal: `GLASS_SURFACE_CLASSES` is composed once
 * in `packages/ui/src/tokens` and imported by the components that adopt the material, so
 * `bg-glass` never appears written out anywhere. Searching for the identifier is therefore
 * the only way to ask the question — and it is the honest one, because the alternative
 * assertion (some file spells out `bg-glass`) would pass on a file that adopted the material
 * by copy and paste, which is the thing the composition exists to prevent.
 */
function glassAdopters(): string[] {
  return [uiComponentsRoot, webSourceRoot]
    .flatMap((root) => listSourceFiles(root))
    .filter((file) => readFileSync(file, 'utf8').includes('GLASS_SURFACE_CLASSES'))
    .map((file) => path.relative(repoRoot, file).replace(/\\/g, '/'));
}

function colorUtilities(candidates: readonly string[]): string[] {
  return candidates.filter((candidate) => {
    for (const prefix of COLOR_UTILITIES) {
      if (!candidate.startsWith(`${prefix}-`)) continue;
      const argument = candidate.slice(prefix.length + 1);
      if (argument.length === 0) continue;
      if (NON_COLOR_ARGUMENTS.has(argument)) continue;
      if (NON_COLOR_SHAPES.some((pattern) => pattern.test(argument))) continue;
      if (prefix === 'text' && NON_COLOR_TEXT_WRAP.has(argument)) continue;
      if (prefix === 'border' && NON_COLOR_BORDER_STYLES.has(argument)) continue;
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
 * The declarations a rule must carry for the candidate to count as generated,
 * per kind.
 *
 * One lookup, two questions. `utilityIsGenerated` cannot answer the animation
 * case: it looks for a *colour* declaration inside the rule for the class, and an
 * `animation:` shorthand is not one — so asking it about `animate-fade-in` was
 * going to report every animation as unresolved. That is the same shape of
 * mistake as checking the whole output for any colour property, which preflight
 * satisfies on its own: a check that is satisfied by something other than the
 * thing it is about.
 */
const ANIMATION_DECLARATIONS = /(?:^|[;{\s])animation(?:-name|-duration|-timing-function)?\s*:/;

/** Every declaration body in `css` whose selector names `className`. */
function ruleBodiesFor(css: string, className: string): string[] {
  const selector = `.${escapeSelector(className)}`;
  const bodies: string[] = [];
  let searchFrom = 0;
  for (;;) {
    const at = css.indexOf(selector, searchFrom);
    if (at === -1) return bodies;
    const after = css[at + selector.length];
    // Reject a longer class that merely starts with this one.
    if (after !== undefined && !/[\s,{:>~+)\]]/.test(after)) {
      searchFrom = at + selector.length;
      continue;
    }
    const open = css.indexOf('{', at);
    if (open === -1) return bodies;
    const close = css.indexOf('}', open);
    if (close === -1) return bodies;
    bodies.push(css.slice(open, close));
    searchFrom = close;
  }
}

/**
 * `background-image` counts as generated for a `bg-*` class.
 *
 * Not a special case for `bg-page-wash` — a general one. `bg-gradient-to-r` is a stock
 * Tailwind utility that emits only `background-image`, and it would fail a colour-only
 * check exactly as `bg-page-wash` does. The question this file asks is "does Tailwind emit
 * a rule for the class a component writes", and a gradient is an emitted rule.
 *
 * Scoped to `bg-` on purpose: a `text-` class emitting `background-image` would be a
 * different mistake, and admitting it here would let a misnamed utility through.
 */
const BACKGROUND_IMAGE_DECLARATION = /(?:^|[;{\s])background-image\s*:/;

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
  const bodies = ruleBodiesFor(css, className);
  if (bodies.some((body) => COLOR_DECLARATIONS.test(body))) return true;
  return (
    className.startsWith('bg-') && bodies.some((body) => BACKGROUND_IMAGE_DECLARATION.test(body))
  );
}

/** The same question, about an `animation` declaration instead of a colour. */
function animationIsGenerated(css: string, className: string): boolean {
  return ruleBodiesFor(css, className).some((body) => ANIMATION_DECLARATIONS.test(body));
}

const allCandidates = collectUtilityCandidates();
const colorCandidates = colorUtilities(allCandidates);
const animationCandidates = [...new Set(allCandidates.filter((c) => /^animate-/.test(c)))].sort();

/**
 * The glass utilities, each with the `@theme` token that carries its value.
 *
 * Asserting that a class *resolves* is not enough for these. `bg-glass` emits a colour and
 * would pass `utilityIsGenerated`; `shadow-glass` emits `box-shadow` and the two
 * `backdrop-*` entries emit a `backdrop-filter` composed from a custom property. None of
 * those is a colour declaration, so the lookup below names the token each rule has to carry
 * — which is a stronger claim anyway, because it is the token, not the class, that the value
 * lives in.
 */
const GLASS_UTILITIES: ReadonlyArray<readonly [utility: string, token: string]> = [
  ['bg-glass', '--color-glass'],
  ['shadow-glass', '--shadow-glass'],
  ['backdrop-blur-glass', '--backdrop-blur-glass'],
  ['backdrop-saturate-glass', '--backdrop-saturate-glass'],
];

/** The two `@theme` blocks, comments stripped: `inline` and the literal one. */
function themeBlocks(): { inline: string; literal: string } {
  const css = readFileSync(path.join(repoRoot, 'packages/ui/src/tokens/theme.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  return {
    inline: css.match(/@theme inline\s*\{([^{}]*)\}/)?.[1] ?? '',
    literal: css.match(/@theme\s*\{([^{}]*)\}/)?.[1] ?? '',
  };
}

/**
 * The fragments a compiled rule must carry for one `@theme` token, **derived from how the
 * token is exposed rather than from what it holds.**
 *
 * Two forms, and the difference is Tailwind's, not this test's:
 *
 * - `@theme inline` entries holding a `var()` reference compile to a rule that names the
 *   *referenced* variable. `--backdrop-blur-glass: var(--automate-glass-blur)` becomes
 *   `blur(var(--automate-glass-blur))` — which is the whole point of `inline`, and why
 *   `--color-glass` still follows the light theme. So the rule carries the **`--automate-*`
 *   name, not the length**, and a test that demanded `8px` here would be failing on a
 *   correctness property of the stylesheet.
 * - A literal `@theme` entry — `--shadow-glass`, like the three elevation steps beside it —
 *   compiles to the value itself, so the variable never appears. And there **only the
 *   geometry is compared**: Tailwind rewrites each colour inside a shadow as
 *   `var(--tw-shadow-color, rgb(0 0 0 / 0.68))` so a `shadow-*` colour utility can retint it,
 *   so the declared value never appears verbatim. The lengths do, and they are what the token
 *   is for — a glass panel's elevation is `--shadow-glass` *because* of its spread and offset.
 */
function expectedFragments(token: string, blocks: { inline: string; literal: string }): string[] {
  const declaration = (block: string): string | undefined =>
    new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim();

  const inlineValue = declaration(blocks.inline);
  if (inlineValue !== undefined) {
    const referenced = [...inlineValue.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(
      (match) => match[1] ?? '',
    );
    if (referenced.length > 0) return referenced;
  }

  const literalValue = declaration(blocks.literal);
  if (literalValue === undefined) {
    throw new Error(
      `theme.css declares neither ${token} in @theme inline nor in @theme, so there is ` +
        'nothing for a compiled rule to carry.',
    );
  }
  // `\d*\.?\d+` rather than `\d+(?:\.\d+)?` — the same language, and written without a
  // quantifier inside a quantifier so `security/detect-unsafe-regex` stops flagging a
  // pattern that cannot actually backtrack. The rule is right to be conservative about the
  // shape and the rewrite costs nothing.
  const lengths = [
    ...new Set([...literalValue.matchAll(/-?\d*\.?\d+px\b/g)].map((match) => match[0])),
  ];
  return lengths.length > 0 ? lengths : [literalValue];
}

const BACKDROP_CANDIDATE = /^backdrop-/;
const glassCandidates = [
  ...new Set([
    ...allCandidates.filter(
      (candidate) => BACKDROP_CANDIDATE.test(candidate) || candidate === 'bg-glass',
    ),
    // `GLASS_SURFACE_CLASSES` is composed in `packages/ui/src/tokens`, which the scanner
    // deliberately excludes, so the classes an adopting component takes from it are added
    // here explicitly. Without this the utilities would only be compiled once some
    // component also spelled them out, and spelling them out is not the design.
    ...GLASS_SURFACE_CLASSES.split(/\s+/),
  ]),
].sort();

/**
 * The `backdrop-*` utilities `theme.css` actually exposes, derived rather than listed.
 *
 * `@theme inline` is the only place a `backdrop-*` utility can come from, so the token
 * names in it *are* the set a component is allowed to write. Deriving from the stylesheet
 * rather than restating it in a second list is the point: a blur radius that is not
 * declared there cannot be written, so it cannot be invented per component.
 */
function glassBackdropUtilities(): string[] {
  const themeCss = readFileSync(path.join(repoRoot, 'packages/ui/src/tokens/theme.css'), 'utf8');
  const inline = themeCss.match(/@theme inline\s*\{([^{}]*)\}/)?.[1] ?? '';
  return [
    ...new Set(
      [...inline.matchAll(/--backdrop-([a-z0-9-]+)\s*:/g)].map(
        (match) => `backdrop-${match[1] ?? ''}`,
      ),
    ),
  ].sort();
}

/**
 * One Tailwind compile of every candidate, shared by the assertions below.
 *
 * `utilityIsGenerated` resolves the rule whose selector names the class, so a
 * single batched build answers "is this class generated?" exactly as well as 48
 * separate builds do — and 48 separate builds put ~30s of blocking compiler work
 * into this package's suite, which starved the React tests running alongside
 * it into timing out.
 *
 * Both the colour and the animation candidates go through it, because "is this
 * class generated" is the same question about both and the batch is cheaper than
 * two batches.
 */
const compiledAll = await buildCss([
  ...colorCandidates,
  ...animationCandidates,
  ...glassCandidates,
]);
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
    // Scanned from both trees, neither of them the token module: the token module
    // *names* tokens like `bg-elevated` in a way that looks like a class, and
    // those names are checked against the CSS by `packages/ui/src/tokens/theme.test.ts`
    // instead.
    expect(existsSync(uiComponentsRoot)).toBe(true);
    expect(existsSync(webSourceRoot)).toBe(true);
    // A silently-empty candidate list would make every assertion below vacuous.
    // The floor moved from 40 when `apps/web/src` joined the scan, which is the
    // point of the scan: the app's colour utilities were not being counted at all.
    expect(colorCandidates.length).toBeGreaterThanOrEqual(45);
    for (const expected of [
      'bg-error',
      'text-error',
      'text-text-muted',
      'bg-brand-50',
      'bg-bg-base',
      // From `apps/web/src`, so a future scan that quietly narrows back to
      // `packages/ui` fails here rather than passing on a smaller list.
      'text-text-secondary',
      'bg-bg-elevated',
      'bg-brand-500',
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

  it('does not use utilities that only a plugin would provide, because none is installed', () => {
    // `tailwindcss-animate` is not a dependency of this repository, and sixteen
    // class names across six components were written against it. Each compiled to
    // nothing, so the dialog, the drawer, the palette, the popover, the tooltip and
    // the empty state appeared instantly — and every test asserting on the class
    // *name* still passed, because the name was right and the utility was not.
    //
    // The reason the list exists in both places: `PLUGIN_PROVIDED_UTILITIES` says
    // do not write these, and the next test says the replacements do generate.
    // A ban with nothing behind it just produces a differently-written dead class.
    const offenders = allCandidates.filter((candidate) =>
      PLUGIN_PROVIDED_UTILITIES.some((pattern) => pattern.test(candidate)),
    );
    expect(
      offenders,
      'These classes come from tailwindcss-animate, which is not a dependency here. ' +
        'Use the `--animate-*` utilities declared in packages/ui/src/tokens/motion.css.',
    ).toEqual([]);
  });

  it('generates CSS for every animation the components animate with', () => {
    // The other half of the ban above. `animate-fade-in` is only real because
    // `packages/ui/src/tokens/motion.css` declares the `@keyframes` and the
    // `--animate-*` entry; asserting the class resolves is what keeps that
    // declaration and its uses in step.
    expect(
      animationCandidates,
      'no animate-* utility was picked up by the scanner, so the assertions below are vacuous',
    ).not.toEqual([]);
    const unresolved = animationCandidates.filter(
      (candidate) => !animationIsGenerated(compiledAll, candidate),
    );
    expect(
      unresolved,
      'Tailwind emits no `animation` for these classes, so the element changes nothing for the ' +
        'length of the duration and then snaps.',
    ).toEqual([]);
    // And the keyframes the product's own animations name are in the output, so a
    // generated `animation` is not an animation of nothing.
    for (const keyframes of ['automate-enter', 'automate-exit', 'automate-zoom-in']) {
      expect(
        compiledAll,
        `${keyframes} is missing from the compiled CSS, so the overlay animations are inert`,
      ).toContain(`@keyframes ${keyframes}`);
    }
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

  /**
   * The blur radius cannot be invented per component.
   *
   * Phase 1 answered the readability concern with a total ban on `backdrop-filter`,
   * and `.github/review-rules/rules.json` named the reason: *the pixels behind a panel in
   * this product are usually the evidence itself*. The concern was right; the ban was the
   * wrong instrument, because it could not say which panels were safe — so it is replaced
   * by a measured rule (the contrast case in `packages/ui/src/tokens/theme.test.ts`) and
   * this list.
   *
   * Both directions are asserted, and the second one is the reason a *list* rather than a
   * pattern is used. Forward: no component writes a `backdrop-*` class outside
   * `GLASS_BACKDROP_UTILITIES`, so `backdrop-blur-md` cannot appear in one panel while the
   * other five use 8px. Backward: every entry is named, by a scanned component source or by
   * `GLASS_SURFACE_CLASSES` — the single composition every adopting component takes — so a
   * token renamed in `theme.css` without the composition following it fails here rather
   * than leaving a utility nothing resolves to.
   *
   * The composition is named separately because `collectUtilityCandidates` deliberately
   * excludes `packages/ui/src/tokens`, where the token module names tokens in a way that
   * looks like a class.
   */
  it('permits exactly the glass backdrop utilities the product declares', () => {
    const writtenByComponents = allCandidates.filter((candidate) =>
      BACKDROP_CANDIDATE.test(candidate),
    );
    const writtenByTheComposition = GLASS_SURFACE_CLASSES.split(/\s+/).filter((tokenClass) =>
      BACKDROP_CANDIDATE.test(tokenClass),
    );
    const declared = new Set([...writtenByComponents, ...writtenByTheComposition]);

    expect(
      [...declared].filter((candidate) => !glassBackdropUtilities().includes(candidate)).sort(),
      'A component writes a `backdrop-*` class that theme.css does not declare, so its blur ' +
        'radius is its own. Use the token: the whole argument against glass is compositing ' +
        'cost, and cost scales with the radius of the kernel.',
    ).toEqual([]);

    expect(
      glassBackdropUtilities()
        .filter((entry) => !declared.has(entry))
        .sort(),
      'theme.css declares a `backdrop-*` utility that no component and no composition uses, ' +
        'so it is a token with no user. Either a component should adopt it or the token ' +
        'should go.',
    ).toEqual([]);
  });

  /**
   * The lint's allowlist and the stylesheet's tokens are the same list.
   *
   * `eslint.config.js` cannot import `packages/ui/src/tokens/glass.ts` — it is a
   * configuration file loaded by Node, and a TypeScript import there would put a compiler
   * between the linter and its own policy. So it holds a literal, and this is what stops
   * the literal from drifting: opening the Phase 1 ban without widening it in the same
   * place is how a `backdrop-blur-md` ends up allowed in one panel and 8px in the other
   * five, which is the exact failure the list was written to prevent.
   *
   * Read as source text rather than imported, because `eslint.config.js` pulls in the
   * whole TypeScript-ESLint dependency tree to run a test about two string literals.
   */
  it('keeps the lint allowlist and the theme tokens in step', () => {
    const config = readFileSync(path.join(repoRoot, 'eslint.config.js'), 'utf8');
    const literal = config.match(/GLASS_ALLOWLIST\s*=\s*\[([^\]]*)\]/)?.[1];
    expect(literal, 'eslint.config.js has no readable GLASS_ALLOWLIST literal').toBeDefined();
    const inLint = [...(literal ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(
      inLint.filter((entry) => !BACKDROP_CANDIDATE.test(entry)),
      'GLASS_ALLOWLIST holds something that is not a `backdrop-*` utility, so it would allow ' +
        'a class the glass tokens cannot produce.',
    ).toEqual([]);
    expect(
      [...inLint].sort(),
      'eslint.config.js permits a different set of `backdrop-*` classes than theme.css ' +
        'declares, so a component can write a blur radius the tokens do not carry.',
    ).toEqual(glassBackdropUtilities());
  });

  it('generates the glass surface utilities, each carrying its own token', () => {
    const blocks = themeBlocks();
    for (const [utility, token] of GLASS_UTILITIES) {
      const bodies = ruleBodiesFor(compiledAll, utility);
      expect(
        bodies,
        `Tailwind emits no rule for ${utility}. The tokens are declared in ` +
          'packages/ui/src/tokens/theme.css, so this means the class name and the token have ' +
          'drifted apart.',
      ).not.toEqual([]);
      const fragments = expectedFragments(token, blocks);
      const normalised = bodies.map((body) => body.replace(/\s+/g, ' '));
      expect(
        fragments.filter((fragment) => !normalised.some((body) => body.includes(fragment))),
        `The rule for ${utility} does not carry ${fragments.join(', ')}, which is what ${token} ` +
          'contributes in theme.css. A generated class that resolves to a hardcoded value is ' +
          'the unstyled-destructive-button defect with a different name.',
      ).toEqual([]);
    }

    // The utilities resolving is not the same as anything using them, and a token set that
    // compiles cleanly while every panel stays opaque is a documented design that nothing
    // shipped. So adoption is part of the assertion rather than something a reviewer has to
    // notice — and it is checked as *the composition being imported*, because a component
    // that spelled `bg-glass` out by hand would be the copy-and-paste the composition is
    // there to prevent.
    expect(
      glassAdopters(),
      'No component takes GLASS_SURFACE_CLASSES, so the glass tokens compile and nothing uses ' +
        'them. The surfaces that adopt the material are named in ' +
        '.kilo/plans/1791096500000-full-glassmorphism-plan.md §5, G4.',
    ).not.toEqual([]);
  });

  it('generates the destructive variant, which is the "Cancel run" button', () => {
    expect(utilityIsGenerated(compiledAll, 'bg-error')).toBe(true);
    expect(compiledAll).toContain('--automate-danger');
  });

  it('generates the error-state utilities used by Input and Select', () => {
    // **`outline-error` is deliberately not here any more.** `Input`, `Select` and
    // `Textarea` each added `focus-visible:outline-error` on top of the base's
    // `focus-visible:outline-border-focus`, which is two classes setting one property on
    // one element — and which one wins is decided by CSS order, not by the order they
    // appear in the class string. The border carries the error instead, so the ring is
    // the same ring everywhere. The assertion that used to name `outline-error` here was
    // holding the duplication in place.
    for (const candidate of ['text-error', 'border-error']) {
      expect(utilityIsGenerated(compiledAll, candidate), `${candidate} generates no colour`).toBe(
        true,
      );
    }
    expect(
      allCandidates.filter((candidate) => /outline-(error|danger)$/.test(candidate)),
      'a field in error is colouring its ring again. The ring says where focus is; the border says ' +
        'what is wrong with the field, and one ring that means one thing is the point of the idiom.',
    ).toEqual([]);
  });

  /**
   * The stacking scale is used by name.
   *
   * `z-10` and `z-50` were in four components and neither said what it was for, so
   * "is this toast above the modal?" was answered by whichever number somebody typed. The
   * numbers are not the decision — *what the layer is* is — so `theme.css` declares
   * `--z-index-chrome` through `--z-index-toast` and this fails on a bare number.
   *
   * A bare `z-50` still compiles, which is the trap: Tailwind accepts any integer whether
   * or not the theme declares a name for it, so the defect is invisible to every
   * resolution check in this file and only a naming rule catches it.
   */
  it('writes no bare stacking number, so every layer says what it is', () => {
    const offenders = [...new Set(allCandidates.filter((candidate) => /^z-\d+$/.test(candidate)))];
    expect(
      offenders.sort(),
      'A component writes a bare `z-<number>`. theme.css declares the six named layers, and the ' +
        'name is the decision — "a toast is above a modal" is answerable, "50 is above 40" is not.',
    ).toEqual([]);
  });

  it('generates the muted-text, brand-shade and base-background utilities', () => {
    for (const candidate of ['text-text-muted', 'bg-brand-50', 'text-brand-700', 'bg-bg-base']) {
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
