# 踩過的坑

每一條都花了真實的時間找出來。共同點：**全部是靜默失效** —— 建置成功、頁面看起來正常，只有在特定條件下才發現壞了。

---

## Lightning CSS 把 animation-timeline 合併掉

**症狀**：所有 scroll-driven 動效在 production 完全失效。dev 正常。

**原因**：Tailwind v4 的打包器 Lightning CSS 把分開寫的兩條宣告合併成簡寫：

```css
/* 我寫的 */
.spine-ink { animation: spine-draw linear both; animation-timeline: scroll(root block); }
/* 它產出的 */
.spine-ink { animation: linear both spine-draw scroll(root) }
```

但 `animation-timeline` 在規格上是簡寫的 **reset-only 子屬性** —— 簡寫只能把它重設為 `auto`，**不能設定它**。整條宣告因此無效被丟棄，computed style 讀到 `animation-name: none`。

**修法**：一律用長寫。

```css
animation-name: spine-draw;
animation-duration: auto;          /* ← 見下 */
animation-timing-function: linear;
animation-fill-mode: both;
animation-timeline: scroll(root block);
```

**連帶的坑**：轉長寫時我寫了 `animation-duration: 1ms`。scroll-driven 的進度由時間軸提供，`duration` 必須是 `auto`；寫死時長等於「在捲動的前 0.001% 就播完」，所有元素停在結束幀。

**怎麼確認修好了**：`document.getAnimations().map(a => a.timeline?.constructor?.name)` 要出現 `ScrollTimeline`。修好之前只有 `ViewTimeline`。

---

## `entry` 階段的長度就是元素高度

動效「看不出來」多半不是幅度不夠，是**範圍太短**。

`animation-range` 的 `entry` 階段，從元素上緣碰到視窗下緣，到元素下緣通過視窗下緣 —— 那段捲動距離**恰好等於元素自己的高度**。

實測這個站：視窗 900px、卡片 155px。

| 範圍 | 捲動距離 |
|---|---|
| `entry 8% → entry 70%` | **96px** —— 滾輪一格就播完了 |
| `entry 0% → cover 45%` | **475px**（4.9 倍） |

`cover` 階段是「視窗高 + 元素高」＝ 1055px，跨度大得多。想讓上下瀏覽全程都在動，範圍要跨到 `cover`，不能只待在 `entry`。

**還要有退場動畫**：只有進場的話，元素一旦完全進入視窗就停在終點狀態，往回捲是一片靜止。掛兩個動畫（逗號分隔），一個 `entry → cover`、一個 `exit`，兩個方向就都有動靜。

> 逗號分隔的長寫在 Lightning CSS 下是安全的 —— `animation-timeline: view(), view()` 與 `animation-range: entry cover 45%, exit` 都完整保留。

## scroll-driven 動效的讀數不可靠

`getComputedStyle` 與 `getComputedTiming().progress` 在動畫剛註冊時會回基礎值／`null`，讓人以為動畫沒跑。而瀏覽器面板的截圖也可能抓到滯後的空白畫格。

**可靠的判斷方式**：讀 `animation.timeline.currentTime`（會是 `"79.25%"` 這種值），並用 `document.elementFromPoint()` 確認元素真的畫在螢幕上。我一度因為截圖全白而準備去改沒壞的東西。

**而且文件隱藏時連這個都不可靠**：`document.visibilityState === 'hidden'` 時，Chrome 不解析 CSS 掛的 scroll-driven 時間軸，所有 `timeline.currentTime` 都回 `null` —— 但**手工 `new ViewTimeline()` 仍算得出來**（同一個元素回報 46.43%）。兩者不一致就是在告訴你：問題在觀測環境，不在程式碼。這種時候改用幾何算（見上一節），不要繼續調數值。

---

## satori 的三個坑

### 一、不支援 WOFF2

README 原文：*"Satori currently supports three font formats: TTF, OTF and WOFF."* / *"WOFF2 is not supported at the moment."*

所以網頁用的 woff2 子集餵不進去，[`build-fonts.mjs`](../scripts/build-fonts.mjs) 必須另產一份 `poster.ttf`。

### 二、缺字是靜默的

satori 沒有系統字型、沒有 fallback chain。缺字**直接畫成空白且不拋錯**。

**修法**：寫了一個最小的 TTF cmap 讀取器（[`scripts/lib/ttf.mjs`](../scripts/lib/ttf.mjs)，71 行，支援 format 4 與 12），逐碼位驗證子集覆蓋，缺字讓建置失敗。它上線後立刻抓到兩批真問題：

- **4 個簡體字**（`没 红 尘 栈`）—— 思源宋體 **TC** 本來就不含簡體專有字形
- 關閉鈕用的 `✕`(U+2715) 不在字型裡（`×` U+00D7 才在）

### 三、`display` 規則的錯誤訊息是誤導的

錯誤訊息說 *"if it has more than one child node"*，但讀 satori 原始碼，實際判斷式是：

```js
if (y === "div" && S && typeof S !== "string" && K !== "flex" && K !== "none" && K !== "contents") throw
```

`S` 是 children、`K` 是 `style.display`。也就是說：**只要 children 不是純字串就要求 `display`**，包括

- 單一元素子節點
- **零子節點**（空陣列在 JS 裡是 truthy）—— 一條純裝飾的分隔線 `<div>` 就會炸

我照著錯誤訊息改了三次都沒中。最後跳出建置迴圈寫最小重現，一次就問出來。**修法**：在 `h()` 裡對所有 `div` 一律補 `display: flex`。

---

## `loading="lazy"` 在 `<dialog>` 裡永遠不會載入

**症狀**：分享面板打開後海報是空白。等 2.5 秒仍 `naturalWidth === 0`；拿掉 `loading` 屬性立刻載入 1080×1440。

**原因**：`<dialog>` 未開啟時是 `display: none`，lazy 圖不會進入載入佇列 —— **而且打開之後也不會補載**。

**修法**：不用 lazy，改成開啟時才設 `src`（`data-src` → `src`）。開啟前 0 個請求，開啟後正確載入。

**同一類陷阱**：微信首圖也不能用 `loading="lazy"`，因為它被移出畫面（`left: -10000px`），lazy 永遠不觸發，微信就抓不到圖。

---

## 直排文字的邏輯屬性會轉向

`writing-mode: vertical-rl` 的元素，**邏輯屬性是相對它自己的書寫方向解析的**：

- `inset-block-start` → 距**右緣**
- `inset-inline-end` → 貼**底**

所以「追雲逐雪」直排落款用 `inset-block-start: 7rem; inset-inline-end: 0` 會跑到右下角而不是右上角。實測：`shellRect.right - sigRect.right === 119px`，正好是那個 7rem。

**修法**：直排元素的絕對定位用**物理屬性**（`top` / `right`）。這是少數該用物理屬性的場合。

---

## `_redirects` 的兩個坑

**一、以空白分欄**。舊站的 `/blog/2020/2020-08-03 Castle Tower` 若寫成真空白，整行解析錯誤。來源必須 `encodeURI`：

```
/blog/2020/2020-08-03%20Castle%20Tower   /tales/trail-run-castle-tower/   301
```

**二、欄寬用固定值會黏住狀態碼**。`padEnd(52)` 遇到超長目標時不補空白：

```
/blog/2017/09-11-2017   /tales/enable-multiple-dhcp-range-for-multiple-nic-with-dnsmasq/301
                                                                                        ↑ 黏住了
```

**修法**：欄寬取實際最大值 + 2，並驗證每行都是三欄（`awk 'NF'`）。

---

## 從別的平台搬 zone 過來，舊記錄會蓋掉一切

搬 zone 到 Cloudflare 時，原平台的 DNS 記錄會被一併匯入，而且**開著橘雲代理**。它們的優先序蓋過 Worker route 與 R2 自訂網域 —— 結果是「綁定成功」但請求還是被轉去舊源站。

這個站踩了兩次：

1. **apex 與 www 的 A 記錄** → Worker 自訂網域註冊成功，但 `jackywu.ca` 仍回 `server: Vercel`
2. **wildcard `*` 記錄** → R2 自訂網域 `media.jackywu.ca` 狀態 active、SSL 也 active，但回 Vercel 的 `DEPLOYMENT_NOT_FOUND`

**怎麼確認是 wildcard**：打一個隨機子網域。

```bash
curl -s "https://zzz-$RANDOM-nope.jackywu.ca/" | head -c 60
# 有回應 ⇒ 有 wildcard 在攔截
```

**修法**：在 Cloudflare DNS 刪掉指向舊源站的 A/AAAA 記錄（含 `*`），MX/TXT/CAA 不要動。Cloudflare 會自己補上正確的記錄。

## 重編已經編好的影片會變大

`-crf 21` 重編一支 32 MB 的 H.264 檔，產出是 **61 MB**。來源本來就編得不錯，重編只是往回走。

**修法**：先驗來源。編碼是 H.264、像素格式 yuv420p、寬度 ≤1920、音訊是 AAC —— 全中就只做 remux（`-c copy -movflags +faststart`），無損且瞬間完成。這樣 32 MB 進、32 MB 出（只多幾十 KB，那是 moov atom 搬到檔頭的開銷）。

## `astro preview` 不吃 `_headers` / `_redirects`

只在 `pnpm preview` 測過就上線，是靜態站常見的翻車原因。要驗證部署行為必須用 **`pnpm serve`**（`wrangler dev`，真的 Workers runtime）。

---

## Cloudflare 邊緣會快取 404

在頁面還不存在時 `curl` 過的 URL，邊緣會把那個 404 快取住；頁面部署好之後仍回 404。驗證時加 cache buster（`?cb=$RANDOM`）才看得到真實狀態。

---

## Astro 7 的 dev server 會自行 daemonize

`pnpm dev` 會退出並留下背景行程。用 `astro dev status` / `astro dev stop` 管理。另外 content collection 設定改動後**需要重啟** —— 我一度以為時光機是空的，其實是 dev server 陳舊，建置產物才是對的。

---

## slug 撞號會靜默覆蓋

舊站三篇技術文的 frontmatter 共用同一個 `slug`（`pi-vpn-wifi-ap-and-vpn-gateway`）。舊站沒用那個欄位所以沒爆；新站照用就會三篇寫進同一個目錄互相覆蓋，最後只剩一篇。

**修法**：撞號時改用標題衍生，並在寫檔前**硬性斷言唯一**、撞了就整批中止。已反向驗證會中止並指出來源檔。

## 刪掉內容檔之後 build 失敗，錯在 data-store

刪一個 `src/content/**` 底下的檔案（尤其是 dev server 開著的時候），
`node_modules/.astro/data-store.json` 可能還記著它，於是下一次 `astro build`
炸在一個看不懂的地方：

```
[vite]: Rolldown failed to resolve import
"astro:content-layer-deferred-module?…fileName=src%2Fcontent%2F…%2Findex.en.mdx…"
from ".astro/content-modules.mjs"
```

glob loader 明明已經回報「No files found matching …」，但 `content-modules.mjs`
仍照著舊的 store 產生 import。

**解法**：刪掉 store 就好，不必動旁邊的 `assets/`（那是圖片最佳化快取，
刪了要重跑幾十張）：

```bash
rm -f node_modules/.astro/data-store.json && rm -rf .astro
```

實測過：只清 `.astro/` 沒有用，dev server 會照著 store 再寫一份回去。

## MDX 的 import 後面沒有空行，整篇正文會消失

MDX 把開頭連續的 `import` 當成 ESM 區塊。**沒有空行隔開的話，下一行中文也會被
丟進 JavaScript 解析器**：

```
14:14: Could not parse esm with oxc: Invalid Character `，`
```

更糟的是 **dev server 不會報錯**——它回 200，但 `.scroll` 是空的，整篇正文不見了。
看起來像元件壞了，其實是解析失敗。

```mdx
import trail from './trail.jpg';
                                  ← 這一行空行是必要的
這篇是……
```

判斷方法：拿一篇本來就好好的文章當對照組，數它的 `<p>`。對照組正常而新的那篇
是 0，就是這一篇的解析問題，不是 dev server 壞了。

## `<Video entry>` 要的是 collection id，不是 yaml 裡的 `id`

reel 的 yaml 有一個欄位就叫 `id`（`metal-dome`），那是 **R2 的物件 key**。
而 `<Video entry="…">` 要的是 collection 的 id，由路徑推導（`2026/metal-dome`）。
同名不同義，很容易寫錯。

`Video.astro` 會把現有的全部列出來，不會只說「找不到」。

## `astro check` 在 TypeScript 7 上直接崩潰

TypeScript 7（原生編譯器）沒有 `astro check` 依賴的程式化 API（`ts.sys`、
`findConfigFile`）。裝了 7.x，`astro check` 不會回報型別錯誤，而是在開始之前丟例外——
於是**型別錯誤全部被藏起來**。曾經因此累積了 12 個錯誤，其中一支腳本
（`scripts/orphans.mjs`）連 Node 都解析不了。

`typescript` 鎖在 `^6`，直到 [withastro/roadmap#1321](https://github.com/withastro/roadmap/discussions/1321)
有結果。判斷方法：`pnpm check` 的輸出若是「does not expose the programmatic API」，
就是版本問題，不是程式碼問題。

