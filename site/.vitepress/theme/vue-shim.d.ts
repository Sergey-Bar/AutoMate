/**
 * `*.vue` as a module, so `tsc` can read `.vitepress/theme/index.ts`.
 *
 * **This file exists because the claim it corrects was in that file's header, and the
 * header was wrong.** It said a `.vue` import is "invisible" to the site's `tsc`,
 * meaning unresolvable-and-therefore-unchecked. What is actually true is that an
 * unresolvable import is an *error*, and `pnpm verify` failed on it the first time the
 * file was built: `error TS2307: Cannot find module './Layout.vue'`.
 *
 * So the modules resolve, and what they resolve to is deliberately shallow:
 *
 * - **`DefineComponent` rather than a real prop type.** `vue` is a dependency of
 *   VitePress and not of this package, and adding it as a direct dependency to type
 *   two components would be a dependency edge for a shim. What is checked — and what
 *   is worth checking — is that the module resolves, that `index.ts`'s own types are
 *   sound, and that `satisfies Theme` holds. A `.vue` file's props and template are
 *   compiled by `vue-tsc` or by the build, and this package has neither.
 * - **No `vue-tsc`.** The components' correctness is checked by the build, which has
 *   to compile them for `site:build` to produce anything at all — and
 *   `scripts/lib/site-doctor-dom.test.mjs` runs that build and then asserts the pages
 *   it produced. That is a weaker guarantee than a type-checked SFC and it is a real
 *   one.
 */
declare module '*.vue' {
  import type { Component } from 'vue';

  const component: Component;
  export default component;
}
