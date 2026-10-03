import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';

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
 * Whether Tailwind emitted a *rule for this class* carrying a colour
 * declaration.
 *
 * Checking the whole output for any colour property is worthless: preflight
 * alone contains `color: inherit` and `background-color: transparent`, so that
 * check passes for every candidate including ones Tailwind ignored. This looks
 * up the rule whose selector names the class, then inspects that rule.
 */
function utilityIsGenerated(css: string, className: string): boolean {
  return ruleBodiesFor(css, className).some((body) => COLOR_DECLARATIONS.test(body));
}

/** The same question, about an `animation` declaration instead of a colour. */
function animationIsGenerated(css: string, className: string): boolean {
  return ruleBodiesFor(css, className).some((body) => ANIMATION_DECLARATIONS.test(body));
}

const allCandidates = collectUtilityCandidates();
const colorCandidates = colorUtilities(allCandidates);
const animationCandidates = [...new Set(allCandidates.filter((c) => /^animate-/.test(c)))].sort();

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
const compiledAll = await buildCss([...colorCandidates, ...animationCandidates]);
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

  it('generates the destructive variant, which is the "Cancel run" button', () => {
    expect(utilityIsGenerated(compiledAll, 'bg-error')).toBe(true);
    expect(compiledAll).toContain('--automate-danger');
  });

  it('generates the error-state utilities used by Input and Select', () => {
    for (const candidate of ['text-error', 'border-error', 'outline-error']) {
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
