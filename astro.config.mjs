import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

const site = process.env.SITE_URL ?? 'https://rushibalapure.site';

export default defineConfig({
  site,
  output: 'static',
  integrations: [mdx(), sitemap({ filter: (page) => !new URL(page).pathname.startsWith('/spacexaiintro/') })],
  markdown: {
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: true,
    },
  },
});
