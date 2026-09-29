import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Automate',
  description: 'AI-orchestrated QA platform',
  // A GitHub project page is served from `/<repo>/`, so the base has to be set or
  // every asset URL resolves one level too high and the site renders unstyled.
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
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Operations', link: '/operations' },
      { text: 'Quality', link: '/quality/findings' },
      { text: 'Capabilities', link: '/capabilities' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Contributing', link: '/contributing' },
        ],
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
          { text: 'Capabilities', link: '/capabilities' },
          { text: 'Findings', link: '/quality/findings' },
          { text: 'Coverage', link: '/quality/coverage' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Sergey-Bar/AutoMate' }],
    search: { provider: 'local' },
  },
});
