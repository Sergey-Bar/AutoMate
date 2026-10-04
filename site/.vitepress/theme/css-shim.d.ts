/**
 * `*.css` as a module, so `tsc` can read `.vitepress/theme/index.ts`.
 *
 * TypeScript 6 made `noUncheckedSideEffectImports` default to true, which turns a
 * side-effect import of a file with no type declarations into an error. The theme does
 * `import './custom.css'`, and a stylesheet has no type to declare — Vite resolves it
 * at build time and the bundler, not the type checker, is what has an opinion.
 *
 * `error TS2882: Cannot find module or type declarations for side-effect import of
 * './custom.css'` is therefore not a defect in the site. It is the new default meeting a
 * correct import, and the two possible responses are to declare the module or to turn the
 * check off. Declaring is right: a shim says what is true, and a disabled check says
 * nothing while silencing every future CSS import too.
 *
 * **The alternative was `vite/client`,** whose types do declare `*.css`, and it is
 * already reachable in this workspace — `vitepress` depends on `vite`. It was not used
 * because reaching into a transitive dependency's type surface to satisfy the compiler is
 * the same move as adding an undeclared dependency: it works until the dependency graph
 * changes shape, and nothing would say so. `vue-shim.d.ts` sits next to this file
 * declaring `*.vue`, and it makes the same argument about `vue` being a dependency of
 * VitePress rather than of this package.
 */
declare module '*.css';
