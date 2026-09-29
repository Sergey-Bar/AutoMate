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
  // `srcDir` points at `site/pages`, not at the package root.
  //
  // The home page is `site/index.md` because VitePress resolves `/` from the
  // srcDir, so it has to be in the same place as everything else — and it is,
  // because a *generated* file cannot be written into the package root without a
  // build step that would fight the checkout. `pnpm site:generate` writes the
  // status pages here; the three of them carry a marker and the generator refuses
  // to overwrite a page without one, so a hand-written page is a conflict rather
  // than something a build overwrites.
  srcDir: '.',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Operations', link: '/operations' },
      { text: 'Capabilities', link: '/pages/capabilities' },
      { text: 'Findings', link: '/pages/quality/findings' },
      { text: 'Coverage', link: '/pages/quality/coverage' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [{ text: 'Getting started', link: '/guide/getting-started' }],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Operations', link: '/operations' },
        ],
      },
      {
        text: 'Status',
        items: [
          { text: 'Capabilities', link: '/pages/capabilities' },
          { text: 'Findings', link: '/pages/quality/findings' },
          { text: 'Coverage', link: '/pages/quality/coverage' },
        ],
      },
    ],
    search: { provider: 'local' },
  },
});
