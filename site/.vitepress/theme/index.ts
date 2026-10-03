import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import Layout from './Layout.vue';
import './custom.css';

/**
 * The site's theme, and it is the product's theme.
 *
 * **`extends: DefaultTheme` rather than a theme of our own.** VitePress's default
 * gives the nav, the sidebar, the search box and the outline; replacing it would mean
 * rebuilding all four in order to look different, and a documentation site whose nav
 * is a hand-rolled div is a documentation site that does not work on a phone.
 * `custom.css` maps VitePress's own CSS variables onto the product's tokens, which
 * is the same result with no second implementation.
 *
 * `custom.css` is imported **before** the components so that a VitePress stylesheet
 * order change cannot land on top of the token mapping. It is the only import here
 * that has an opinion about order, and the order is the whole of the opinion.
 *
 * ## The home page is a slot, not a swapped layout
 *
 * VitePress resolves `layout: home` to its own `VPHome`, which draws the hero and the
 * feature grid out of front matter. Registering a component *named* `Home` does not
 * replace it — `VPHome` has no slot that looks for one — so the first version of this
 * file built cleanly and rendered a default hero with the evidence chain missing from
 * the page entirely. The chain is mounted through the documented `home-hero-after`
 * slot in `Layout.vue` instead, and `site/index.md` sets `hero: false` so VitePress's
 * own hero is not drawn above it.
 *
 * ## `index.ts` rather than `index.js`, and what the `.vue` shim does and does not check
 *
 * The site's `tsc --noEmit` includes every `.ts` under `.vitepress`. It has no
 * `vue-tsc`, so it cannot read an SFC — and an *unresolvable* import is an error, not an
 * absence, which is the correction: this file's header used to claim the import was
 * invisible, and `pnpm verify` failed on `TS2307` the first time it was built.
 *
 * `vue-shim.d.ts` next to this file makes `*.vue` resolve, to `Component` rather than to
 * a real prop type. `vue` is a dependency of VitePress and not of this package, and
 * adding it here would be a dependency edge for a shim.
 *
 * What that means concretely: **the module resolution, this file's own types, and the
 * `satisfies Theme` check are all live.** What is not checked is the inside of the two
 * components — their props, their template, their expressions — and the guarantee that
 * stands in for it is that `site:build` has to compile them for the build to produce
 * anything, plus `scripts/lib/site-doctor-dom.test.mjs`, which runs that build and then
 * asserts the pages it produced. That is weaker than a type-checked SFC. It is not
 * nothing, and the honest move is to say which it is rather than let the shim imply the
 * stronger thing.
 */
export default {
  extends: DefaultTheme,
  Layout,
} satisfies Theme;
