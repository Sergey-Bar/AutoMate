/**
 * The glass policy, in one module, because four different places need to agree
 * about it and a second copy of any of them would be a second authority.
 *
 * **The values themselves live in `theme.css`.** They are theme-dependent — the fill
 * is derived from `--automate-surface` — so they belong in the stylesheet beside the
 * four plane steps they extend. What is here is the part that is a *rule* rather than
 * a colour: the floor a fill may not go below, the ranges the effect was scheduled
 * within, the radius ceiling, and the list of `backdrop-*` utilities a component is
 * permitted to write.
 *
 * `.kilo/plans/1791096500000-full-glassmorphism-plan.md` §2 and §3 are the reasoning.
 * The short version: the whole argument against glass is cost and legibility, and both
 * scale with the radius of the kernel and the strength of the saturation, so the floor
 * of each scheduled range is where this ships and the ceiling waits on a measurement.
 */

/**
 * The lightest a data panel's fill may be.
 *
 * A floor rather than a guideline because below it the contrast against the
 * worst-case backdrop stops being measurable, and §3's third mechanism — the contrast
 * case that moved from "token vs plane" to "token vs backdrop" — has nothing to
 * measure. `theme.test.ts` fails if `--automate-glass-fill` declares less.
 */
export const GLASS_MIN_FILL_PERCENT = 72;

/**
 * The scheduled blur range, 8–16px, and the saturation range, 1.05–1.15.
 *
 * Both are ceilings as well as floors: `theme.test.ts` asserts the stylesheet sits at
 * or below `ceiling`, so reaching the top half of either range is a deliberate act with
 * a rendering measurement behind it rather than a number somebody typed.
 */
export const GLASS_BLUR_PX = { floor: 8, ceiling: 16 } as const;
export const GLASS_SATURATE = { floor: 1.05, ceiling: 1.15 } as const;

/**
 * A radius ceiling, not a default.
 *
 * A radius that grows past a panel's content starts rounding the data inside it, and
 * rounded evidence columns are harder to compare down a column than square ones.
 */
export const GLASS_MAX_RADIUS_PX = 12;

/**
 * The only `backdrop-*` utilities a component may write.
 *
 * This is the list `eslint.config.js` reads to open the ban it enforced during Phase 1 —
 * or, rather, `theme.css` declares the tokens and
 * `apps/web/src/theme-resolution.test.ts` asserts that the two agree in both directions,
 * because a flat config cannot import a TypeScript module and `apps/web` cannot import
 * the config without inheriting ESLint. A blur radius that `theme.css` does not declare
 * cannot be written, and one it does declare is checked against the scheduled range by
 * `theme.test.ts`, so the chain from "a component typed a number" to "that number
 * shipped" is closed at both ends.
 */
export const GLASS_BACKDROP_UTILITIES = ['backdrop-blur-glass', 'backdrop-saturate-glass'] as const;

/**
 * The classes a glass surface carries.
 *
 * One exported string rather than four call sites, because a panel that adopts three of
 * the four is a panel with a translucent fill and no blur — or a blur and no fill — and
 * neither is what the token set describes. `shadow-glass` rather than a border token
 * because a glass border's whole job is to describe the panel's edge against whatever is
 * behind it, which is a function of the backdrop and therefore not a colour a token can
 * hold — see the design language's two-border rule.
 *
 * **`rounded-glass` is deliberately absent, and so is the `--radius-glass` utility that
 * would produce it.** `--automate-glass-radius` is a *ceiling*, and every surface that
 * adopts glass already sits under it — `rounded-md` 6px, `rounded-lg` 8px, `rounded-xl`
 * 12px. Exposing a ceiling as a utility would only invite treating it as a default, and
 * every panel that took it would flatten the radius scale for no gain. The ceiling is
 * enforced by `theme.test.ts`, which is where a ceiling belongs; a token nobody has to
 * apply cannot be forgotten by a component that never sees it.
 *
 * Merged with `cn` at the call site so a component's own classes win.
 */
export const GLASS_SURFACE_CLASSES =
  'bg-glass shadow-glass backdrop-blur-glass backdrop-saturate-glass';
