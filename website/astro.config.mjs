// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://burnlist.dev',
  integrations: [
    starlight({
      title: 'Burnlist',
      description:
        'A repo-local burndown tracker and multi-agent build-loop runner — CLI, dashboard, and declarative Ovens.',
      customCss: ['./src/styles/custom.css'],
      components: { Header: './src/components/DocsHeader.astro' },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/layoutit/burnlist',
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [{ slug: 'getting-started' }, { slug: 'install' }],
        },
        {
          label: 'Reference',
          items: [{ slug: 'cli' }, { slug: 'dashboard' }],
        },
        {
          label: 'Ovens',
          items: [{ slug: 'ovens' }],
        },
      ],
    }),
  ],
});
