// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://jackywu.ca',
  trailingSlash: 'always',
  // 純靜態：不掛任何 adapter，dist/ 直接交給 Workers static assets
  output: 'static',
  integrations: [mdx()],
  vite: { plugins: [tailwindcss()] },
  image: { responsiveStyles: true },
  markdown: {
    shikiConfig: { theme: 'github-light', wrap: true },
  },
});
