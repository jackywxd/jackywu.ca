# 分享子系統

## 先說清楚做不到的事

不先講明白，這一節的設計就看不懂為什麼要這樣繞。

| 期待 | 現實 |
|---|---|
| 在微信 App 內分享時自訂卡片的標題／描述／縮圖 | **靜態站不可能。** 需要已認證的公眾號 + 後端用 `appSecret` 換 `jsapi_ticket` 對當前 URL 簽章 + `wx.config()`。這需要一個持有密鑰的伺服器端點，與「純靜態」互斥 |
| 微信讀 `og:image` | **不讀。** 微信站內分享取 `<title>` 與 **DOM 順序第一張、寬高皆 ≥300px 的 `<img>`**。`og:*` 只在「用外部瀏覽器分享出去」時有用 |
| 小紅書貼連結會出現預覽卡 | **不會，而且會被打壓。** 2026 年規則主動壓制站外導流：外鏈、微信號、二維碼、聯絡方式，**連圖片裡被 OCR 出來的文字都算**。輕則限流 15 天，重則封號 |

**所以策略反轉**：不去求平台幫忙做卡片，**自己把卡片做成圖片**。這在小紅書本來就是原生做法（大家發的都是圖），在微信則靠首圖技巧兜住。

## 建置期產三種圖

爬蟲不跑 JS，OG 圖必須是靜態檔。三個 Astro endpoint 在 `astro build` 時直接寫成 `dist/` 裡的真實檔案。

| 端點 | 尺寸 | 用途 | 版面 |
|---|---|---|---|
| `/og/<kind>/<id>.png` | 1200×630 | `og:image` / Twitter / Telegram | 左文字（行當 + 徽記 + 標題 + 鉤子 + 數據），右路線輪廓或行當字標，底部界欄 + 落款 |
| `/wx/<kind>/<id>.jpg` | 600×600 | 微信站內縮圖 | 大字標題（**必須在 200×200 下仍可辨識**，微信會再縮）、路線、落款、主要數據 |
| `/share/<kind>/<id>.jpg` | **1080×1440** | 小紅書直式海報 | 匾額、主視覺、金句大字、標題、數據、右緣直排「追雲逐雪」、左下朱砂印。**無網址、無二維碼、無任何可 OCR 的導流文字** |

上下各留 8% 安全邊，小紅書 3:4 版位不會裁到關鍵元素。

管線：`satori` → SVG（文字已轉成 `<path>`）→ `@resvg/resvg-js` → PNG/JPEG。因為文字已成 path，光柵化階段**不需要任何字型** —— 這正是這條管線能在 CI 的乾淨容器裡跑的原因（librsvg 找不到系統中文字型是常見的坑，這裡繞過了）。

不用 React：satori 吃的是 `{type, props}` 物件，[`lib/poster/h.ts`](../src/lib/poster/h.ts) 十幾行就夠。

> satori 有三個會靜默壞掉的坑（不支援 WOFF2、缺字不報錯、`display` 規則的錯誤訊息誤導），詳見 [踩過的坑](gotchas.md#satori-的三個坑)。

## 索引頁也要有卡片

文章與行跡頁本來就有分享圖，**索引頁一開始沒有** —— 首頁、四個行當、年份頁、輿圖、
江湖冊、爐火、掌櫃、影、尋，全都沒有 `og:image`，也沒有微信首圖。把 `https://jackywu.ca/`
貼到微信，抓不到任何圖；而首頁正是最常被分享的那個網址。

這些頁面沒有 hero、沒有 `verse`，所以卡片內容由 `src/lib/poster/pages.ts` 明寫：

```ts
{ slug: 'home', path: '/', title: '紅塵客棧', subtitle: site.signature, glyph: '雪', realm: 'run' }
```

`toShareItem()` 把它轉成 `ShareItem` 的形狀，三種版面（og / wx / share）就不必各寫一份。
`kicker` 是顯式欄位 —— 早一版讓它從 `realm` 推導，首頁卡片左上角就掛出一個「追雲」，
那是行當標籤，不是首頁的身份。

端點在 `src/pages/{og,wx,share}/page/[...slug]`，頁面用 `pageShareUrls(slug)` 反查自己那三張：

```astro
<Base share={pageShareUrls('home')} …>
<Base share={pageShareUrls(realm)} …>          {/* 四個行當 */}
<Base share={pageShareUrls(`year/${year}`)} …> {/* 年份頁 */}
```

年份清單來自 `archiveYears()`，**與年份頁同一個函式**。兩邊各算一次的後果實測過：
2021、2022 有頁面卻沒有分享圖（那兩年只有爐火文，不進時光機），`verify-links` 當場報斷鏈。

## 微信 300×300 首圖：四條規則

在 `<body>` 最開頭（`<header>` 之前）放一張建置期產的 600×600 JPEG：

```html
<img src="/wx/routes/xxx.jpg" width="600" height="600"
     alt="" aria-hidden="true" role="presentation"
     decoding="async" fetchpriority="low" class="wx-thumb">
```
```css
.wx-thumb { position:absolute; left:-10000px; top:0;
            width:600px; height:600px;      /* 必須是真實佈局尺寸 */
            opacity:0; pointer-events:none; contain:strict; }
```

1. **不能 `display:none` / `visibility:hidden` / `width:0`** —— 微信的挑圖邏輯依賴圖片被實際載入且有尺寸。用 `position:absolute` 移出畫面 + `opacity:0`
2. **不能 `loading="lazy"`** —— 移出視窗的 lazy 圖永遠不會載入。最常見的兇手
3. **不能 `srcset` / `<picture>`** —— 微信只看 `src`
4. **必須 JPEG 或 PNG** —— 舊版微信 X5 內核對 WebP 支援不穩

代價每頁約 14 KB，抵銷方式：`fetchpriority="low"` 不搶 LCP、`contain: strict` 保證零 CLS、**只在有分享圖的頁面放**。

這四條由 [`verify-wechat.mjs`](../scripts/verify-wechat.mjs) 在 postbuild 逐頁檢查，違反就讓建置失敗。

## 分享面板是展示器，不是產生器

海報建置期就存在了，所以 `<dialog>` 只是顯示那張原圖：

- **手機**：「長按圖片存到相簿」—— iOS 的微信／小紅書內建瀏覽器**不支援 `<a download>`**，長按是唯一可行路徑。這是正確的行動端做法，不是妥協
- **桌機**：`<a download>`
- `navigator.share` 存在時多一顆「系統分享」（iOS 上會列出微信、小紅書）
- `<dialog>` 原生有 focus trap、Esc 關閉、`::backdrop`，不需要 focus-trap library

海報用 `data-src` → 開啟時才設 `src`：開啟前 0 個請求，開啟後才載入。（不能用 `loading="lazy"`，見 [踩過的坑](gotchas.md#loadinglazy-在-dialog-裡永遠不會載入)。）

## 兩份剪貼簿文案

刻意分成兩顆按鈕。

**小紅書版 —— 絕對不含網址**

```
威士拿 UTMB 100K

卑詩 · 威士拿
100.5 km · 5,372 m↑

#越野跑 #跑步 #卑詩 #威士拿
```

放了網址是負資產。品牌承載完全交給海報上的印章與「追雲逐雪」—— 那是**名字**，不是連結。

話題詞用行當對應的實際熱詞（`run → 越野跑, 跑步`）加上切開的地名，不是站內的行當名（`#追雲` 在小紅書上沒人搜）。

**微信版 —— 含網址**

```
威士拿 UTMB 100K
卑詩 · 威士拿
https://jackywu.ca/routes/whistler-utmb-100k-2026/
```

`navigator.clipboard.writeText()` 必須在 click handler 中**同步呼叫**（iOS Safari 要求 user gesture 且不能被 await 中斷）；微信 Android 的 X5 內核可能沒有 Clipboard API → 回退到隱藏 `<textarea>` + `execCommand('copy')`。

## Meta 與 JSON-LD

完整 `og:*`（含 `og:image:width/height/alt`、`og:locale=zh_TW`）+ `twitter:card=summary_large_image` + `canonical`。文章用 `BlogPosting`、輿圖用 `CreativeWork`。

`shareable: false` 的文章不輸出 `og:image`、不輸出微信首圖、不出現分享面板，JSON-LD 只留最小 `Article`。

## 微信讀 og:image，而且裁成方形

實測推翻了原本的假設：把連結貼進微信，卡片縮圖用的是 **`og:image`**，不是 `<body>`
裡第一張 `<img>`，而且會**置中裁成方形**（1200×630 取中央 630×630）。

早一版的 `ogLayout` 是左文右圖：文字排在左邊 40%，右邊放行當字標。裁完正好落在
空白宣紙上 —— 微信卡片的縮圖是一張什麼都沒有的米色方塊，而站上每一項檢查都是綠的。
（判定方式：把 og 圖照這個規則裁一次，跟微信截圖並排比對，連左上角那一小點
「棧」的尾巴和右緣「雪」的筆畫位置都對得上。）

所以 `ogLayout` 改成**中軸構圖**：kicker、標題、金句、數據、界欄、落款全部置中，
收在 `OG_SAFE = 560` 的一欄裡；路線輪廓或行當字標當背景，也置中。橫著看是完整海報，
裁成方形也還是完整的。中軸鈐印本來就是國風的章法，不是為了遷就微信才這樣排。

`WeChatThumb`（`<body>` 第一張 600×600 JPEG）留著 —— 微信內建瀏覽器的
「分享給朋友」路徑仍會用到它，成本每頁約 9–18KB。

## 裁切檢查

`verify-og-crop.mjs`：把每張 og 圖置中裁成方形，數「真正的墨」（與背景亮度差 > 100
的像素，低對比浮水印不算），比較中央方形佔全圖的比例。中軸構圖接近 100%，偏一邊的
構圖會塌下來。門檻 90%。

反向驗過 —— 拿線上那批舊圖餵進去：首頁 **12.7%**、文章 **52.0%**，`--strict` 回 exit 1；
新版 46 張全部 100.0%，exit 0。

## 驗證器要能報出「這頁沒有卡片」

`verify-wechat.mjs` 早一版只檢查**已經有 `og:image` 的頁面**，所以漏接分享圖的頁面
天生不在它的視野裡 —— 它一路綠燈，而首頁分享出去是一張空卡。這是「探針必須能回報
兩種答案」的反例：不變的讀數通常代表儀器沒接上。

現在改成全站掃描：`dist` 裡每一個 HTML 都必須有分享卡片，除非

- 在 `EXEMPT` 白名單裡（只有 `404.html`），或
- 帶著 `<meta name="x-share" content="quiet">` —— `realm: still` 由 `Base` 的 `quiet`
  prop 輸出，讓「刻意靜默」和「忘了接」在產物裡分得開。

目前：105 頁有卡片、1 頁靜默、1 頁豁免。反向驗過 —— 手動拿掉首頁的 `og:image`，
`--strict` 回 exit 1。

## 真機測試（無法自動化）

**微信**：手機微信給自己發連結 → 開啟 → 右上角 `···` → 分享給朋友 → 檢查**縮圖是不是 `/wx/…`**（這是整個技巧成敗的唯一判準）。**iOS（WKWebView）與 Android（X5 內核）都要測**。抓不到時依序排查：圖是不是 DOM 第一個 `<img>` → 是不是真的被載入 → 是不是 ≥300×300 → 是不是 WebP。

**小紅書**：手機開文章 → 分享 → 長按存圖 → 進小紅書發布 → 確認 3:4 版位沒裁掉標題/金句/雪印、縮圖狀態（~350px 寬）下金句仍看得清、文案裡沒有網址。發布後隔 24h 回頭看有沒有被限流 —— 這是唯一能驗證合規的方式。
