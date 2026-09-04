# 怎麼加內容

日常只有三個指令：

```bash
pnpm new "標題" --realm snow --slug my-slug  照片...   # 開一篇文章
pnpm video ~/Downloads/影片.mp4  my-video-id            # 轉檔 + 上傳 R2
pnpm gpx  ~/Downloads/軌跡.gpx   --slug … --realm …     # 匯入一條行跡
```

圖片**直接丟進文章資料夾**就好，建置期自動最佳化。

schema 的完整欄位在 [內容模型](content.md)。

---

## 一、加一篇文章

### 1. 開一篇

```bash
pnpm new "雪季第一天" --realm snow --slug first-day-of-season
```

想順便把照片帶進去，接在後面：

```bash
pnpm new "雪季第一天" --realm snow --slug first-day-of-season \
  ~/Photos/summit.jpg ~/Photos/slope.jpg
```

它會建好資料夾、寫好 frontmatter、把照片複製進去（第一張自動設為題圖），
並印出 dev 網址。

| 參數 | 說明 |
|---|---|
| `--realm` | `run` 追雲 / `snow` 逐雪 / `road` 鐵馬 / `wild` 探幽 / `forge` 爐火 / `still` 靜 |
| `--slug` | 網址。**中文標題一定要給** —— 推導不出來時腳本會直接擋下來，不會偷偷用爛網址 |
| `--date` | 預設今天 |
| 位置參數 | 任何存在的檔案都會被當成圖片複製進去 |

### 2. 填兩個空

腳本留了兩個必填的空欄位：

```yaml
excerpt: ''            # 20–120 字。給機器讀：meta / RSS / 卡片
heroAlt: ''            # 有題圖就必填
```

沒填的話建置會擋下來並明確告訴你：

```
excerpt: Too small: expected string to have >=20 characters
heroAlt: hero 存在時必須提供 heroAlt（無障礙要求）
```

### 3. 寫

正文直接寫中文，不用管排版 —— `.scroll` 會處理行寬（34 全形字）、行高（1.9）、兩端對齊。

寫完把 `draft: true` 拿掉。

**手動建也行**（不用腳手架時的最小 frontmatter）：

```yaml
---
title: '雪季第一天'
date: 2026-12-14
realm: snow
excerpt: '今年第一次上山。雪還薄，但那條線已經在那裡了。'
verse: '雪還薄，線已經在'
tags: ['滑雪', '惠斯勒']
---
```

**四個必填**：`title`、`date`、`realm`、`excerpt`。

| 欄位 | 說明 |
|---|---|
| `realm` | `run` 追雲 / `snow` 逐雪 / `road` 鐵馬 / `wild` 探幽 / `forge` 爐火 / `still` 靜 |
| `excerpt` | **20–120 字**。給機器讀的：`<meta description>`、RSS、卡片、分享圖 |
| `verse` | ≤40 字。給人看的鉤子，**海報上那一行大字**。不填就退回 `excerpt` |
| `draft: true` | 寫著但先不發。dev 看得到，production 不出頁 |

> `excerpt` 和 `verse` 是兩件事，刻意分開。`excerpt` 是摘要，`verse` 是鉤子。混用兩邊都不好。

### 4. 看一眼

```bash
pnpm dev
```

`http://localhost:4321/tales/first-day-of-season/`

草稿在 dev 看得到。首頁時光機也會即時出現。

### 5. 發

```bash
git add -A && git commit -m "新文章：雪季第一天" && git push
```

push 到 `main` 就自動建置部署。或本機直接 `pnpm deploy`。

---

## 二、加圖片

把圖檔丟進**文章自己的資料夾**：

```
src/content/tales/my-first-ski-day/
  index.mdx
  slope.jpg
  summit.jpg
  gear.jpg
```

### 最簡單：標準 markdown

```mdx
![山頂的雲](./summit.jpg)
```

Astro 會自動最佳化 —— 產出 AVIF / WebP 多尺寸，瀏覽器挑最小的。**你不用做任何事。**

實測同一張圖：`13 KB` (avif) / `26 KB` (webp) / `190 KB` (jpg 後備)。

### 要圖說：`<Figure>`

```mdx
import Figure from '@/components/media/Figure.astro';
import summit from './summit.jpg';

<Figure src={summit} alt="山頂積雲" caption="風從西邊來，雲壓在稜線上。" />
```

| prop | 說明 |
|---|---|
| `src` | **要 import 進來**，不能寫字串路徑 |
| `alt` | 必填。無障礙 |
| `caption` | 圖說。選填 |
| `wide` | 溢出正文欄一些，給真正需要的橫幅照片 |
| `priority` | 首屏的圖傳 `true`（eager + high priority） |

### 並排幾張：`<Gallery>`

```mdx
import Gallery from '@/components/media/Gallery.astro';
import a from './slope.jpg';
import b from './gear.jpg';
import c from './summit.jpg';

<Gallery
  images={[
    { src: a, alt: '雪坡' },
    { src: b, alt: '裝備' },
    { src: c, alt: '山頂' },
  ]}
  caption="那天的三張。"
/>
```

三張以內等寬並排，窄螢幕自動變兩欄。

### 題圖（會被拿去做分享圖）

```yaml
hero: ./summit.jpg
heroAlt: '山頂積雲'      # 有 hero 就必須有 heroAlt，否則建置失敗
```

題圖同時是**微信抓取的首圖**來源。

### 規矩

- **圖片永不滿版** —— 最寬 `measure + 8rem`。滿版是雜誌感，不是宣紙
- 原圖放進去就好，**不用先壓縮**。建置期會處理
- 格式無所謂（jpg / png / heic 轉過的都行），輸出一律 AVIF/WebP
- 圖片放 `src/` 才會被最佳化。`public/` 是原樣輸出，只放 favicon 那類

---

## 三、加影片

影片不進 git，也不進 `dist/` —— 走 **R2**（`media.jackywu.ca`）。Workers 單檔上限是 25 MiB，影片一定超過。

### 1. 轉檔 + 上傳（一行）

```bash
pnpm video ~/Downloads/'Best Powder Day.mp4' best-powder-day
```

`best-powder-day` 是 id：小寫、英數、連字號。

腳本會：

1. **先驗來源** —— 已經是 H.264 + yuv420p + ≤1920 + AAC 就**只做 remux**（無損、瞬間）。否則才重新編碼
2. 抽一張 poster
3. 上傳到 R2，帶 `immutable` 快取標頭
4. 印出你要貼進 yaml 的 `duration` / `bytes` / `ratio`

> 為什麼先驗來源：`-crf 21` 重編一支 32 MB 的 H.264 會產出 **61 MB**。來源本來就編得不錯，重編只是往回走。

### 2. poster 放進內容目錄

腳本會告訴你暫存位置：

```bash
cp /var/folders/.../best-powder-day/poster.jpg src/content/reel/best-powder-day-poster.jpg
```

### 3. 建條目

```yaml
# src/content/reel/best-powder-day.yaml
title: '那天的粉雪'
id: best-powder-day               # 對應 R2 上的 video/<id>/1080p.mp4
poster: ./best-powder-day-poster.jpg
posterAlt: '樹林間的粉雪痕跡'
duration: 214                     # 秒，腳本會給
bytes: 32919067                   # 腳本會給
ratio: '16/9'                     # 腳本會給實際尺寸
realm: snow
date: 2026-02-14
caption: '一整個冬天就等這一天。'   # 選填
```

### 4. 用它

**在文章裡**：

```mdx
import Video from '@/components/media/Video.astro';

<Video entry="best-powder-day" />
```

**什麼都不做**也行 —— 影片條目會自動出現在 `/reel/` 和首頁時光機上。

### 播放器行為

- `preload="none"` —— **不點就一個位元組都不下載**。頁面只載 poster
- poster 走 `astro:assets` 最佳化，點下去才撤掉並開始播
- 圖說明碼標出長度與大小（`1:52 · 約 31 MB`），對行動網路使用者是基本禮貌

### 影片太大？

單檔超過約 500 MB 才需要考慮切 HLS。在那之前 `<video>` + `faststart` 的 range request 已經能 seek —— 實測 `206 Partial Content` 正常。

---

## 四、加行跡（GPX 路線）

**不要手寫 yaml。** 用匯入腳本，它會算出真實的距離與爬升，並產生路線圖與海拔剖面。

```bash
pnpm gpx ~/Downloads/race.gpx \
  --slug squamish-50-2026 \
  --name 'Squamish 50' --nameEn 'Squamish 50 Miler' \
  --realm run \
  --region '卑詩 · Squamish' \
  --date 2026-08-15 \
  --badge 'S50 · 50mi · 2026'
```

先看數字對不對，加 `--dry` 只印不寫：

```bash
pnpm gpx ~/Downloads/race.gpx --dry
```

選填：`--elapsed PT10H07M`（ISO 8601）、`--result '完賽'`、`--note '…'`

產出四個檔，全部進 git：

```
src/content/routes/squamish-50-2026.yaml          數據
src/content/routes/squamish-50-2026.svg           路線輪廓（~780 點）
src/content/routes/squamish-50-2026.thumb.svg     粗簡版（~72 點，給卡片）
src/content/routes/squamish-50-2026.profile.svg   海拔剖面
```

支援 `<trkpt>`（軌跡）與 `<rtept>`（路線，GaiaGPS 匯出的）兩種格式。

> 爬升用遲滯門檻算，不是直接加總正高差（後者會被 GPS 噪音灌水 2–3 倍）。
> 外部校準：UT Whistler 100K 官方 100 km / 5,400 m，本管線算出 100.5 km / 5,372 m。
> 路線頁會標註「數據由軌跡檔計算，非賽事官方公布值」。

---

## 五、發之前

```bash
pnpm build
```

三支檢查會跑，任一不過就失敗：

| 檢查 | 常見的失敗原因 |
|---|---|
| **字型缺字** | 用了 TC 字型沒有的字（多半是簡體）。錯誤訊息會列出碼位 |
| **斷鏈** | 連到不存在的頁面，或 `_redirects` 指向不存在的目標 |
| **微信首圖** | 通常不會壞，除非動了 `WeChatThumb` |

schema 錯誤會更早擋下來（`excerpt` 太短、有 `hero` 沒 `heroAlt`、`realm` 拼錯…）。

看一眼真實部署行為（`pnpm preview` 不吃 `_headers` / `_redirects`）：

```bash
pnpm serve
```

---

## 你不用管的事

寫完一篇文章 build 一次，這些全自動發生：

| | |
|---|---|
| 題圖與內文圖 | 轉成 AVIF / WebP 多尺寸 |
| 分享圖 | OG 1200×630、微信 600×600、小紅書海報 1080×1440 |
| 微信首圖 | 塞進 `<body>` 第一個位置並通過四條挑圖規則 |
| 時光機 | 依日期插進年份脊柱 |
| 行當頁 | 出現在對應的追雲／逐雪／鐵馬／探幽 |
| 標籤頁 | 依 `tags` 建立或加入 |
| 搜尋索引 | Pagefind 重建（含中文分詞） |
| RSS / sitemap | 重新產生 |
| 中文字型 | 依你新寫的字重新子集化 |

---

## 常見問題

**中文寫繁體還是簡體？**
繁體。站上用的是思源宋體 TC / 霞鶩文楷 TC，**簡體專有字形不在字型裡**，會靜默退回系統字。建置期的缺字檢查會抓到並讓建置失敗，所以你不會不小心發出去。

**文章要出現在時光機上？**
`realm` 是 `run` / `snow` / `road` / `wild` 四個之一就會。`forge`（爐火）與 `still`（靜）不進。

**想寫一篇不想被分享的？**
`realm: still`。schema 會強制 `shareable: false`：不產分享海報、不出微信首圖、不出現分享面板、不進時光機、不渲染標籤。

**分享海報長怎樣？**
建置後在 `dist/share/tales/<slug>.jpg`，直接開來看。`verse` 是上面那行大字。

**改了內容但線上沒變？**
HTML 是 `max-age=0, must-revalidate`，部署後立刻生效。如果還是舊的，多半是你本機的 DNS 或瀏覽器快取 —— 見 [部署](deployment.md)。
