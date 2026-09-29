import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Automate',
  description: 'AI-orchestrated QA platform',
  // A GitHub project page is served from `/<repo>/`, so the base has to be set or
  // every asset URL resolves one level too high and the site renders unstyled.
  //
  // Left unset by default because **no deployment exists yet** — no workflow
  // builds or publishes this package. `SITE_BASE` is the input a deploy workflow
  // will pass, and a build that renders unstyled is the visible failure if it
  // ever forgets to.
  base: process.env.SITE_BASE ?? '/',
  // `dist`, not VitePress's default `.vitepress/dist`.
  //
  // Two existing rules then cover the output without being extended: turbo's
  // `build` task caches `dist/**`, and the repository's `dist/` gitignore rule
  // already excludes it. Keeping the default would mean one of the two no longer
  // applies, and the first thing that fails is the secret scan reading minified
  // output as text.
  outDir: 'dist',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    // One page exists. VitePress does not validate `themeConfig` links, so a nav
    // entry pointing at an unwritten page builds green and ships a 404 — which
    // is how a stub site starts making claims it cannot back. Adding a page and
    // its entry is one change, on purpose.
    nav: [{ text: 'Home', link: '/' }],
    sidebar: [{ text: 'Home', link: '/' }],
    search: { provider: 'local' },
  },
});
