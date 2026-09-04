# 設計系統：國風 · 江湖

原則一條：**氣氛由排版與留白產生，不由裝飾產生。** 江湖氣不是加毛筆邊框，是該空的地方真的空。

## 「雪」字標

字標描自 `zhuiyunzhuxue-wechat-avatar.png`。原圖是**兩層錯位構造**：

- **灰色殘影層**帶箭頭 —— 行進過的軌跡，「過去」
- **白色實層** —— 「現在」

這本身就是一台時光機，所以整個站的動效邏輯都建立在它上面。

機器上沒有 potrace/ImageMagick，所以 [`scripts/trace-mark.mjs`](../scripts/trace-mark.mjs) 自己做了 marching-squares 等值線抽取 + Douglas–Peucker 化簡。產物 `src/assets/brand/snow-mark.svg` 約 8.6 KB，13 + 5 個封閉路徑。

> 化簡容差不能只靠調 epsilon：降到 0.45 時，白/黑交界的反鋸齒像素會產生 1px 細絲，loop 數從 13 暴增到 79。**要按面積濾**（`MIN_AREA = 40` 原圖像素²），才能同時保留水滴的曲線又不留雜訊。

### 四個變體

| variant | 用在哪 | 形態 |
|---|---|---|
| `solid` | 導覽、favicon | 單色 `currentColor`，只有實層 |
| `full` | 頁尾 | 雙層，殘影 `--fg-3` |
| `seal` | **落款** | 白文印：實心朱砂方印、字用 mask 挖空成透明 |
| `ring` | 大尺寸備用 | 朱砂細環 + 縮小的字（原圖形態） |
| `watermark` | 首屏、行當頁 | `clamp(20rem,45vw,42rem)`、`opacity .06`、**永遠切出版面邊緣** |

浮水印永遠被裁切不是隨意 —— 完整置中是企業感，被裁切的才是宣紙上蓋歪的印。

落款用**白文印**而不是原圖的細圓環，是量出來的決定：圓環的 `stroke-width` 在 1000 viewBox 裡是 14 單位（1.4%），渲染到頁首的 15px 時只剩 **0.21px**，等於看不見。實心塊面才是小尺寸讀得出來的形態。挖空用 `mask` 做成透明，明暗兩套主題自動適應。

## 招牌與落款

[`Wordmark.astro`](../src/components/brand/Wordmark.astro)：印章鈐在「紅塵客棧」右下角，壓在基線下方 —— 那是書法落款的位置，不是 logo 靠左的西式排法。

三個數值用 `em`，由使用點覆寫（大字與小字的視覺關係不同，不能共用一組）：

| 變數 | 頁首 (18px) | 首頁大字 (128px) |
|---|---|---|
| `--seal-size` | 0.40em | 0.34em |
| `--seal-gap` | 0.28em | 0.22em |
| `--seal-drop` | 0.06em | 0.26em |

兩個實作上的陷阱：

1. **不要在 `.wordmark` 自己身上宣告這些變數。** `.brand-name` 與 `.wordmark` 是同一個元素、同樣的 specificity，靠來源順序決勝；而祖先（`h1`）設的值會被元素自己的宣告蓋掉。**兩種覆寫方式都會失效**。改用 `var(--seal-size, 0.46em)` 的 fallback 給預設值。
2. **`.wordmark` 必須 `line-height: 1`。** 招牌不是正文，繼承正文的 1.9 會讓元素框遠高於字，貼著框底的印就會莫名其妙掉下去一大截 —— 頁首的印「太低」就是這個原因，不是 `--seal-drop` 設錯。

## 色

全部取自印章原圖。`--fg-3` 是唯一一個刻意「不用」原色的：

```
--color-stone  #8C8781  對宣紙 #F2EFE6 只有 3.0:1 —— 只夠 18px 以上大字
--color-ink-soft #4A443F 對宣紙 8.4:1 —— 小字用這個
```

所以 `--fg-3` 指向 `ink-soft`，`--fg-mute` 才是 `stone`。這在 P2 就量了，不等最後才發現對比不足。

**朱砂是功能色不是裝飾色**：只有「這是當前的」「這裡結束了」配得上蓋印。一頁不超過兩處。第一版的時光機卡片同時把朱砂用在節點、徽記、行當標籤、草稿標記與路線縮圖 —— 五處，紅一多就俗。收斂成只剩脊柱節點。

夜行的選擇器刻意與既有草稿 `grouse-grind-pole-experiment.mdx` **一字對齊**（`:root[data-theme="dark"]` 與 `:root:where(:not([data-theme="light"]))` + `prefers-color-scheme`），那篇文章原樣貼進來就能用。

## 中文字型：14.6 MB → 374 KB

這是這個站能不能成立的關鍵。

**為什麼不能用現成方案**：完整霞鶩文楷 TC 是 14.6 MB。通用的 unicode-range 分包（`@fontsource/lxgw-wenkai-tc`）是 **348 個 woff2 分包**，一頁仍要拉約 700KB，還會吃掉 Workers 的檔案額度。Astro 7 的 Fonts API 很好，但它的 `subsets` 是 Google 那套命名子集，**對 CJK 沒有「只留我用到的字」的能力**。

**做法**（[`scripts/build-fonts.mjs`](../scripts/build-fonts.mjs)，prebuild）：

```
掃 src/**（.astro .ts .mdx .yaml .css）收集所有非 ASCII 字元
  ├─ display 集：UI 標籤 + 內容的 title/name/verse/badge → 思源宋體 TC（釘 wght 500）
  └─ body 集   ：全部                                     → 霞鶩文楷 TC
  ↓ subset-font（harfbuzz wasm）
  display.woff2  171 KB / 691 字
  body.woff2     374 KB / 1203 字
  poster.ttf     596 KB  ← satori 專用，不進 dist
```

**掃原始碼而不是掃建置後的 HTML**，是為了讓 dev 與 production 用同一套字 —— 設計時看到的就是線上看到的。掃原始碼會漏掉的部分，由 postbuild 的 [`verify-fonts.mjs`](../scripts/verify-fonts.mjs) 掃 `dist` 補上檢查。

> 收集範圍必須是**所有非 ASCII**，不能只挑 CJK 區段。第一版只挑 CJK，漏掉了 `·`(U+00B7)、`↑`、`—` 這類符號，海報上直接開天窗（「卑詩　威士拿」中間是空的）。

原始字型約 30.7 MB，**不進 git**，由 [`fetch-fonts.mjs`](../scripts/fetch-fonts.mjs) 取回；取不到就大聲失敗，不會靜默沿用舊子集。

CI 預算閘門：> 800 KB warn、> 1.2 MB fail。

## 動效

`animation-timeline` 目前約 84% 全球支援（Chrome/Edge 115+、Safari 18+；Firefox 穩定版仍在 flag 後）。用 `@supports` 分流，不支援時退回 25 行的 IntersectionObserver。

| 動效 | 機制 |
|---|---|
| 開場落款 | 先寫字（`clip-path` 由左向右 760ms）、再鈐印（縮放落下帶微旋 340ms）。**sessionStorage 記一次瀏覽只演一次** |
| 脊柱描線 | `animation-timeline: scroll(root block)` 驅動 `scaleY` —— 捲多少，路走多長 |
| 年號浮現 | `view()`，年號淡入上浮 + 背後墨暈綻開 |
| 鈐印節點 | `view()`，`scale 1.35→1` + 微旋，`cubic-bezier(.16,.84,.44,1)`（起筆快收筆慢） |
| 卡片展開 | `clip-path` 由左向右攤開 + 上移 4rem + 淡入，**範圍 `entry 0% → cover 60%`** |
| 卡片退場 | 離開視窗上緣時淡出下沉。沒有退場的話，往回捲是一片靜止 |
| 跨頁轉場 | 原生 `@view-transition`，**零 JS** |

> **範圍比幅度重要。** `entry` 階段的長度就是元素高度 —— 155px 的卡片在 900px 視窗裡，`entry 8% → entry 70%` 只有 96px 的捲動距離，滾輪一格就播完。改成跨到 `cover 60%` 之後是 633px，約 4.9 倍。細節見[踩過的坑](gotchas.md#entry-階段的長度就是元素高度)。

**無障礙不是加個 media query 就算**：`prefers-reduced-motion` 除了用 `!important` 蓋掉 CSS，IntersectionObserver 的 script 開頭也要先檢查並**直接不註冊** —— 光靠 CSS 蓋掉不夠，observer 仍會加 class 造成重繪。

> ⚠️ Lightning CSS 會把 `animation` 簡寫與 `animation-timeline` 合併成一條**無效**的簡寫，讓所有 scroll-driven 動效在 production 靜默失效。必須用長寫。詳見 [踩過的坑](gotchas.md#lightning-css-把-animation-timeline-合併掉)。

## 留白（版面規則，不是感覺）

- `--measure: 34em` —— 中文可讀行長是 **30–38 個全形字**。`65ch` 是拉丁習慣
- 右側 `--spine: 6rem` **永遠空著**，只放直排落款與目錄。這是全站最重要的一條留白規則
- 章節間距走費氏級數 `0.5 / 0.75 / 1.25 / 2 / 3.25 / 5.25 / 8.5rem` —— 等差給工整感，費氏給呼吸感
- 圖片最寬 `calc(var(--measure) + 8rem)`，**永不滿版**（滿版是雜誌感不是宣紙）
- 首屏空白 > 45%

## 四個行當：一套機制，四組值

底色、紙紋、字型、留白、印章**完全共用**，只換 `--accent` 與 `--realm-glyph`：

```css
[data-realm="run"]  { --accent:#B93A32; }  /* 追雲 · 雲 */
[data-realm="snow"] { --accent:#6E7A85; }  /* 逐雪 · 雪 —— 與站標同源，滑雪是本家 */
[data-realm="road"] { --accent:#8A5A2B; }  /* 鐵馬 · 馳 */
[data-realm="wild"] { --accent:#4E6152; }  /* 探幽 · 探 */
```

導覽前兩項讀起來是**追雲 · 逐雪** —— 正是署名，而兩個行當字標「雲」與「雪」剛好把署名拆成兩半。

`--color-seal` 朱砂**不隨行當變** —— 印是掌櫃的印，不是分類的。
