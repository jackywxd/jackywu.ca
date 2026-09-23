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
    // 雙主題：每個字同時帶淺色（inline color）與 --shiki-dark 變數，由 scroll.css 依站上的
    // 深色選擇器切換。只用單一 github-light 的話，底色跟著主題變深、字色卻寫死成深色，
    // 夜行模式下全站程式碼的對比只剩約 1.1:1 —— 等於看不見。
    shikiConfig: { themes: { light: 'github-light-high-contrast', dark: 'github-dark' }, wrap: true },
  },
});
