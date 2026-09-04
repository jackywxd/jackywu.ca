# 架構與選型

## 為什麼是 Astro

不是因為它流行，是因為三件具體的事：

1. **預設零 JS 對「國風 + 留白」是結構性優勢。** 這個站的互動只有五處（主題切換、搜尋、分享面板、年份撥盤、開場動畫），其餘全是排版。任何 React/Next 方案都要先付一份 runtime 才開始排版；Astro 的頁面可以真的送 0 bytes JS。對一個講「瀟灑」的站，這不是效能指標，是設計態度。

2. **Cloudflare 於 2026-01-16 收購了 Astro 團隊**（Astro 仍是 MIT、平台中立）。純靜態站**完全不需要 adapter**：`astro build` 出 `dist/`，`wrangler deploy` 帶 `assets.directory` 就結束。沒有 SSR runtime、沒有 adapter 版本地獄。

3. **build time 編譯是硬需求。** Content Collections + `glob()` loader 在建置期把 MDX 全部用 zod 驗證、渲染、產生型別。frontmatter 寫錯 → 建置失敗，不是上線後才發現。舊站的 frontmatter 之所以爛成那樣，正是因為沒有東西在驗。

## 版本

| 層 | 套件 | 版本 |
|---|---|---|
| 框架 | `astro` | 7.3.1 |
| MDX | `@astrojs/mdx` | 8.0.0 |
| 樣式 | `tailwindcss` / `@tailwindcss/vite` | 4.3.3 |
| 圖片 | `sharp` | 0.35.x |
| 產圖 | `satori` / `@resvg/resvg-js` | 0.33.4 / 2.6.2 |
| 字型子集 | `subset-font` | 2.7.0 |
| 搜尋 | `astro-pagefind`（內含 pagefind 1.5.2） | 2.0.1 |
| 部署 | `wrangler` | 4.129.0 |
| 執行環境 | Node / pnpm | 22 / 11 |

## 刻意不用的東西

每一項都有理由，不是漏掉。

| 沒用 | 為什麼 |
|---|---|
| `@tailwindcss/typography` | 它的 `line-height: 1.75` 與 `max-width: 65ch` 是拉丁排版習慣。套到中文會變成一行 65 個全形字，讀起來像跑馬拉松。中文要 **1.9 / 34em**。與其一路 override，不如自寫 [`scroll.css`](../src/styles/scroll.css) |
| `astro-expressive-code` | **Astro 7 內建 Shiki**，語法高亮不需要外掛。而且 expressive-code 會注入自己整套框線視覺，與水墨系統正面衝突 |
| GSAP / Framer Motion / Lenis | 動效全走原生 CSS scroll-driven animation。見 [設計系統](design-system.md#動效) |
| `<ClientRouter/>` | 改用原生 `@view-transition { navigation: auto }`，省掉整份 runtime |
| React / Preact | 五個互動點用 vanilla 即可。加框架＝為了五個按鈕付 40KB |
| `astro-icon` | 這個站的圖示是手繪水墨筆畫，不是 Lucide |
| giscus 留言 | 要 GitHub 帳號，大陸讀者用不了 |
| `hls.js` | 影片 < 300MB 時，`<video>` + `-movflags +faststart` 的 range request 已能 seek。**觸發條件**：單檔 > 500MB 才裝 |
| SSR adapter | 純靜態站不需要。加了反而多一層可能出錯的東西 |

## 資訊架構

首頁**就是**時光機 —— 開場落款之後直接進入年份脊柱。這是這個站與一般部落格的分界。

一條軸，三種條目交錯：**文章**（有正文）· **行跡**（賽事／雪日／騎行／探險，多半只有數據）· **影**（影片）。

| 路徑 | 名 | 內容 |
|---|---|---|
| `/` | 門前 | 開場 + 全站時光機 |
| `/run/` `/snow/` `/road/` `/wild/` | 追雲 · 逐雪 · 鐵馬 · 探幽 | 同一條軸過濾 `realm` |
| `/tales/<年>/` | — | 一年一頁 |
| `/tales/<年>/<slug>/` | — | 文章 |
| `/routes/` `/routes/<年>/<slug>/` | 輿圖 | 路線總覽與單條 |
| `/reel/` | 影 | 影片牆 |
| `/tags/` `/tags/[tag]/` | 江湖冊 | 標籤 |
| `/keeper/` | 掌櫃 | 關於 |
| `/search/` | 尋 | Pagefind |

**URL 一律 ASCII，顯示名一律中文。** 中文 URL 在微信／小紅書會變成 `%E6%B1%9F%E6%B9%96` 的噪音；舊站的 `%20` 已是前車之鑑。標籤是唯一的例外（中文標籤保留漢字，但空白一律轉連字號）。

**內容目錄以年分層，網址跟著走**（`src/content/tales/2020/xxx/` → `/tales/2020/xxx/`）。年份不只是路徑的一段，也是可以點進去的層級 —— 時光機的年號連到 `/tales/<年>/`，那一頁只列該年，並有前後年翻頁。

`forge`（爐火，舊技術文）與 `still`（靜，私人文）**不進時光機**——它們仍有 URL、仍被 301 保住，只是不出現在這條線上。這是 [`lib/timeline.ts`](../src/lib/timeline.ts) 的過濾條件。

## 一份資料，五個視圖

四個行當頁不是四份程式碼，是 `getTimeline({ realm })` 加一個過濾條件。標籤頁同理。加一個行當＝在 [`lib/site.ts`](../src/lib/site.ts) 的 `realms` 加一筆。
