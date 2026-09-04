# 紅塵客棧

> 一間江湖客棧。跑步、滑雪、鐵馬、探險，都記在同一條時間軸上。
>
> <https://jackywu.ca> — 署名「追雲逐雪」

國風靜態站。首頁不是文章列表，是一台**時光機**：文章、行跡、影片按日期串在同一條年份脊柱上。

## 快速開始

```bash
pnpm install
pnpm dev          # http://localhost:4321（會先取回字型並做子集化）
```

Astro 7 的 dev server 會自行 daemonize：

```bash
pnpm exec astro dev status
pnpm exec astro dev stop
```

## 常用指令

| 指令 | 做什麼 |
|---|---|
| `pnpm dev` | 開發伺服器 |
| `pnpm build` | 建置。前有字型子集化，後有三支驗證，任一不過就失敗 |
| `pnpm serve` | 用 **Workers runtime** 跑 `dist/` —— 這才吃得到 `_headers` 與 `_redirects` |
| `pnpm check` | `astro check`（型別 + content schema） |
| `pnpm deploy` | 部署到 Cloudflare |
| `pnpm gpx <file.gpx> --slug … --realm … --date …` | 匯入一條軌跡成輿圖條目 |

> `pnpm preview` 用的是 Astro 的靜態伺服器，**完全不理 `_headers` 與 `_redirects`**。
> 驗證部署行為請用 `pnpm serve`。

## 目錄地圖

```
src/
  content.config.ts      內容契約（zod）。frontmatter 寫錯 → 建置失敗
  content/
    tales/<slug>/        文章 + 該文的圖，同一個資料夾
    routes/<slug>.yaml   輿圖條目 + 產生的路線 SVG 與海拔剖面
    reel/<slug>.yaml     影片條目（指向 R2）
  lib/                   site 常數、時光機合併、格式化、標籤、分享、產圖
  components/
    brand/               雪字標的四個變體、招牌落款
    timeline/            年份脊柱、節點、三種卡片
    share/               微信首圖、分享面板
    mdx/                 可在 MDX 直接用的元件
  styles/                token / 基底 / 中文正文 / 動效 / 字型
  pages/                 路由。og · wx · share 是建置期產圖端點
scripts/
  build-fonts.mjs        ★ 中文字型子集化（14.6MB → 374KB）
  verify-*.mjs           三支 postbuild 檢查
  ingest-gpx.mjs         GPX → 距離/爬升/路線圖/剖面
  migrate/               舊站遷移四階段
docs/                    見下
public/
  _headers _redirects    Cloudflare 快取策略與 301 對照
```

## 文檔

| | |
|---|---|
| [架構與選型](docs/architecture.md) | 用了什麼、為什麼、**刻意不用什麼** |
| [設計系統](docs/design-system.md) | 色票、雪字標、中文字型管線、動效 |
| [內容指南](docs/content.md) | frontmatter schema、四行當、怎麼加文章／輿圖／影片 |
| [分享子系統](docs/sharing.md) | 微信與小紅書的**真實限制**，以及對應的做法 |
| [部署](docs/deployment.md) | Cloudflare Workers、網域、轉址、CI |
| [舊站遷移](docs/migration.md) | 四階段管線與清點推翻的三個前提 |
| [驗證](docs/verification.md) | 三支檢查在驗什麼、怎麼反向驗證 |
| [踩過的坑](docs/gotchas.md) | **最值得先讀的一份**。每一條都花了真實的時間 |

## 現況數字（實測）

| | |
|---|---|
| 頁面 | 97 |
| 首頁傳輸 | 9.7 KB gzip |
| 自有 JS | 內聯，文章頁約 0.7 KB gzip |
| Pagefind UI | 37.6 KB gzip，**只在 `/search/` 載入** |
| 中文字型 | 題字 171 KB + 正文 374 KB（原始檔 30.7 MB） |
| 分享圖 | 27 篇 × 3 種尺寸 |
| 舊網址轉址 | 29 條 |

## 技術棧

Astro 7.3.1 · Tailwind CSS v4.3.3 · MDX · Cloudflare Workers static assets（**無 adapter**）· pnpm · Node 22

授權：程式碼未指定；內容與「雪」字標為 Jacky Wu 所有。
字型 [霞鶩文楷 TC](https://github.com/lxgw/LxgwWenKaiTC) 與 [思源宋體 TC](https://fonts.google.com/noto) 皆為 OFL 1.1。
