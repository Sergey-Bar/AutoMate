import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook, for this package's twenty-nine stories.
 *
 * These files were missing. `packages/ui/package.json` has carried `storybook` and
 * `storybook:build` scripts and four Storybook dependencies for as long as it has
 * had stories, so `pnpm --filter @automate/ui storybook` resolved a binary that then
 * failed with "no configuration files found" — and twenty-nine component stories
 * were unreachable. The failure mode is the repository's own: a declared capability
 * with nothing behind it.
 *
 * **Why `viteFinal` injects Tailwind rather than a `postcss.config.js`.** Tailwind
 * v4's integration point is a Vite plugin; the PostCSS path v3 needed is not how it
 * composes any more. Injecting it here means the same stylesheet the application
 * loads is the one Storybook loads, which is the entire point of having the tool.
 *
 * **What `viteFinal` deliberately does not do: fix the source path.** It would have
 * been the natural place — an absolute `@source`, computed here, has no relative
 * path to get wrong. An earlier draft did exactly that and it silently resolved to
 * nothing. `src/storybook.css` now carries the same load order without the
 * substitution, and its header records what was measured so the next person does
 * not spend the afternoon again.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    plugins: [...(viteConfig.plugins ?? []), tailwindcss()],
  }),
};

export default config;
