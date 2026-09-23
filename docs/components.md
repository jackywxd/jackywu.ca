# MDX 元件

文章裡能用的五個元件。**都不必 `import`** —— 它們在
[`src/pages/tales/[...slug].astro`](../src/pages/tales/[...slug].astro) 統一註冊，
MDX 直接寫標籤就好。少一行儀式，也少一個「路徑打錯所以整篇 build 失敗」的機會。

> **圖片仍然要 import。**元件不用，圖片要：`Figure` 與 `Gallery` 吃的是
> `astro:assets` 的 `ImageMetadata`，不是字串路徑。見下面 `Figure` 那節。

**可執行的範例是站上的[凡例](https://jackywu.ca/manual/)**（原始碼在
`src/content/pages/manual.mdx`）——每個元件都在那一頁實際跑一次，源碼與效果上下對照。
它跟其他內容一起過 schema、一起編譯，還有一支 e2e 盯著它的元件有沒有渲染出來，
所以不會像文件裡的程式碼片段那樣悄悄爛掉。

相關：[寫作](authoring.md) · [內容模型](content.md) · [設計系統](design-system.md)

---

## `<Route>` 路線圖

```mdx
<Route of="whistler-utmb-100k-2026" from={40} to={55} caption="Singing Pass 到 Musical Bumps" />
```

| prop | 型別 | 預設 | 說明 |
|---|---|---|---|
| `of` | `string` | 必填 | 路線 slug，可寫 `whistler-utmb-100k-2026` 或含年份的 `2026/whistler-utmb-100k-2026`。**寫錯會 build 失敗**並列出現有路線 |
| `show` | `'profile' \| 'track' \| 'both'` | `'profile'` | 爬升剖面／平面輪廓／兩張都要 |
| `from` `to` | `number` | — | 高亮這一段（公里），其餘變淡 |
| `at` | `number` | — | 在某一公里處畫一條標記線 |
| `label` | `string` | `"<at> 公里"` | 標記的文字 |
| `caption` | `string` | — | 圖說 |

**預設畫剖面不是平面輪廓**，因為一條俯視的曲線只說明「繞了一圈」，
而讀者想知道的是那裡有多陡、你在第幾公里垮掉的。

`from`/`to`/`at` 能對得準，是因為剖面的 x 軸就是累計距離的線性映射
（[`lib/gpx.mjs`](../scripts/lib/gpx.mjs) 的 `profileSvg`：`x = cum[j] / total * 1000`），
所以「第 40 公里在哪」是算出來的，不是目測。

刻度依總長自動取整齊間隔（目標 4–7 條）。靠近起點或終點的標記標籤會自動改成
靠邊對齊，不會溢出圖外。

---

## `<Figure>` 單張圖

**圖片要先 import**，路徑相對於文章自己的資料夾：

```mdx
import summit from './summit.jpg';

<Figure src={summit} alt="山頂回望，雲層在腳下" caption="海拔 2,100 公尺" />
```

| prop | 型別 | 預設 | 說明 |
|---|---|---|---|
| `src` | `ImageMetadata` | 必填 | `import` 進來的圖，不是字串路徑 |
| `alt` | `string` | 必填 | 空字串只在圖純屬裝飾時才對 |
| `caption` | `string` | — | 圖說 |
| `wide` | `boolean` | `false` | 溢出正文欄一些。**永不滿版**——滿版是雜誌感，不是宣紙 |
| `priority` | `boolean` | `false` | 首屏的圖傳 `true`，改用 eager + 高優先 |

`astro:assets` 會產 AVIF／WebP 多尺寸，並自動帶上 `width`/`height` 消除 CLS。
圖放在文章自己的資料夾裡，**刪文章＝刪圖**，不留孤兒。

---

## `<Gallery>` 圖組

```mdx
import a from './a.jpg';
import b from './b.jpg';

<Gallery images={[{ src: a, alt: '起跑線' }, { src: b, alt: '補給站' }]} caption="賽前一小時" />
```

| prop | 型別 | 說明 |
|---|---|---|
| `images` | `{ src: ImageMetadata; alt: string }[]` | 每張都要 `alt` |
| `caption` | `string` | 整組共用的圖說 |

---

## `<Video>` 影片

```mdx
<Video entry="2026/metal-dome" caption="下滑那一段。" />
```

| prop | 型別 | 說明 |
|---|---|---|
| `entry` | `string` | reel 條目的 **collection id**（由路徑推導，`2026/metal-dome`），**不是** yaml 裡那個也叫 `id` 的欄位——那是 R2 的物件 key。找不到會 build 失敗並列出現有的 |
| `caption` | `string` | 圖說 |

影片本體在 R2（`media.jackywu.ca`），`preload="none"`，所以一頁三支影片的初始
成本就是三張 poster 圖。檔案大小會標在圖說旁——對行動網路的讀者是基本禮貌，
也很合客棧掛牌明碼的調性。加影片的流程見 [authoring.md](authoring.md#三加影片)。

---

## `<MissingImage>` 失連的圖

```mdx
<MissingImage original="https://lh3.googleusercontent.com/…" hint="2015 新加坡 Sundown" />
```

| prop | 型別 | 說明 |
|---|---|---|
| `original` | `string` | 原始網址，留著日後撈得回來時有線索 |
| `hint` | `string` | 這張圖本來是什麼 |

渲染成一塊留白佔位，中央一個淡墨的「闕」字。舊站有 19 個 Google 相簿熱鏈已經
失效——**在水墨語境裡「缺一張圖」是可以被設計的**，比破圖 icon 好，也比偷偷
刪掉誠實。

---

## 沒有元件的東西

一般 Markdown 語法照常：標題、清單、引用、表格、程式碼區塊
（Shiki，主題是自訂的墨色）。CJK 排版規則在
[`src/styles/scroll.css`](../src/styles/scroll.css)——行高 1.9、行長 34em，
刻意不用 `@tailwindcss/typography`，它的 1.75／65ch 對中文是錯的。
