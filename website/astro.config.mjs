// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://burnlist.dev',
  integrations: [
    starlight({
      title: 'Burnlist',
      description:
        'A repo-local burndown tracker with a read-only observer dashboard and declarative Ovens.',
      favicon: '/favicon.svg',
      head: [
        { tag: 'meta', attrs: { property: 'og:title', content: 'Burnlist' } },
        {
          tag: 'meta',
          attrs: {
            property: 'og:description',
            content:
              'A repo-local burndown tracker with a read-only observer dashboard and declarative Ovens.',
          },
        },
        { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
      ],
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
          label: 'Concepts',
          items: [{ slug: 'lifecycle' }],
        },
        {
          label: 'Reference',
          items: [{ slug: 'cli' }, { slug: 'dashboard' }],
        },
        {
          label: 'Ovens',
          items: [
            { slug: 'ovens', label: 'Overview' },
            { slug: 'ovens/checklist' },
            { slug: 'ovens/differential-testing' },
            { slug: 'ovens/streaming-diff' },
            { slug: 'ovens/performance-tracing' },
          ],
        },
      ],
    }),
  ],
});
