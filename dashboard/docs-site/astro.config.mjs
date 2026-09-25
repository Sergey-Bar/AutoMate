import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://automate-hq.github.io/automate',
  integrations: [
    starlight({
      title: 'Automate',
      description: 'Self-hosted Playwright QA Dashboard — real-time monitoring, failure analysis, and historical trends.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/automate-hq/automate' },
      ],
      editLink: {
        baseUrl: 'https://github.com/automate-hq/automate/edit/main/docs-site/',
      },
      sidebar: [
        { label: 'Getting Started', slug: 'getting-started' },
        { label: 'Reporter Setup', slug: 'reporter' },
        { label: 'Deployment', slug: 'deployment' },
        { label: 'Configuration', slug: 'configuration' },
        { label: 'Features', slug: 'features' },
        { label: 'Architecture', slug: 'architecture' },
      ],
    }),
  ],
});
