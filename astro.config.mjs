// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import pagefind from 'astro-pagefind';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://jackywu.ca',
  trailingSlash: 'always',
  // 純靜態：不掛任何 adapter，dist/ 直接交給 Workers static assets
  output: 'static',
  integrations: [
    mdx(),
    pagefind(),
    sitemap({
      // 「靜」與分享圖端點不進 sitemap
      filter: (page) =>
        !page.includes('/tales/in-memory-my-beloved-wife/') &&
        !/\/(og|wx|share)\//.test(page),
    }),
  ],
  vite: { plugins: [tailwindcss()] },
  image: { responsiveStyles: true },
  markdown: {
    shikiConfig: { theme: 'github-light', wrap: true },
  },
});
