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
      { text: 'Guide', link: '/guide/' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Operations', link: '/operations' },
      { text: 'Design', link: '/guide/design-language' },
      { text: 'Capabilities', link: '/pages/capabilities' },
      { text: 'Findings', link: '/pages/quality/findings' },
      { text: 'Coverage', link: '/pages/quality/coverage' },
      { text: '10/10', link: '/pages/quality/ten' },
    ],
    /**
     * Section landing pages, and the sidebar points at them.
     *
     * `guide/index.md`, `pages/index.md` and `pages/quality/index.md` exist so a reader
     * who lands in a section has something to land *on*. Without them VitePress puts a
     * section heading in the sidebar that goes nowhere, which is worse than not grouping
     * at all: it looks like navigation and is not.
     *
     * The trailing slashes matter. `link: '/guide'` resolves to the section's `index.md`
     * only because `cleanUrls` is on and VitePress rewrites it; the explicit `/guide/`
     * is what the build and `site-doctor` check 4 compare against, and it is the form
     * that survives being copied out of the address bar.
     */
    sidebar: [
      {
        text: 'Guide',
        collapsed: false,
        items: [
          { text: 'Guide', link: '/guide/' },
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'The design language', link: '/guide/design-language' },
        ],
      },
      {
        text: 'Reference',
        collapsed: false,
        items: [
          { text: 'Reference', link: '/pages/' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Operations', link: '/operations' },
        ],
      },
      {
        text: 'Status',
        collapsed: false,
        items: [
          { text: 'Quality', link: '/pages/quality/' },
          { text: 'Capabilities', link: '/pages/capabilities' },
          { text: 'Findings', link: '/pages/quality/findings' },
          { text: 'Coverage', link: '/pages/quality/coverage' },
          { text: '10/10', link: '/pages/quality/ten' },
        ],
      },
    ],
    search: { provider: 'local' },
  },
});
