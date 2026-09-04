# 內容指南

所有內容都由 [`src/content.config.ts`](../src/content.config.ts) 的 zod schema 把關。**寫錯 frontmatter 會讓建置失敗**，不是上線後才發現。

## 三個 collection

| collection | 位置 | 是什麼 |
|---|---|---|
| `tales` | `src/content/tales/<年>/<slug>/index.mdx` | 文章 |
| `routes` | `src/content/routes/<年>/<slug>.yaml` | 輿圖：路線／賽事，多半只有數據 |
| `reel` | `src/content/reel/<年>/<slug>.yaml` | 影片（存在 R2） |

三者由 [`lib/timeline.ts`](../src/lib/timeline.ts) 合成同一條時間軸。

## 六個 realm

| realm | 名 | 進時光機 | 產分享圖 |
|---|---|---|---|
| `run` | 追雲（山野長跑） | ✓ | ✓ |
| `snow` | 逐雪（滑雪·雪山） | ✓ | ✓ |
| `road` | 鐵馬（摩托·長途） | ✓ | ✓ |
| `wild` | 探幽（探險·遠遊） | ✓ | ✓ |
| `forge` | 爐火（舊技術文） | ✗ | ✓ |
| `still` | 靜（私人文） | ✗ | **✗** |

`still` 由 schema 的 `.refine()` **強制** `shareable: false` —— 這件事不能靠人記得。它的效果是：不產分享海報、不出微信首圖、不出現分享面板、不進四行當、不上首頁、不渲染標籤，JSON-LD 只剩最小的 `Article`。

## 寫一篇文章

```
src/content/tales/2026/my-slug/
  index.mdx
  hero.jpg          ← 圖跟文章放同一個資料夾，刪文章＝刪圖，不留孤兒
  detail.jpg
```

```yaml
---
title: '標題'                    # 1–80 字
date: 2026-08-22
realm: run
lang: zh-Hant                    # zh-Hant | en
excerpt: '給機器讀的：meta description、RSS、卡片。20–120 字，必填。'
verse: '給人看的鉤子'             # ≤40 字，海報主文案。選填
tags: ['越野跑', '威士拿']
hero: ./hero.jpg                 # 選填。有 hero 就必須有 heroAlt
heroAlt: '賽道上的日出'
draft: false
featured: false
xhsTags: ['越野跑', '溫哥華']     # 選填，覆寫小紅書話題詞
---

正文。可以用 MDX 元件。
```

**`excerpt` 與 `verse` 是兩件事**，刻意分開：`excerpt` 給機器讀（SEO、RSS、卡片），`verse` 是海報上那一行**鉤子**。混用兩邊都不好。`excerpt` 必填且有長度下限，是為了強迫每篇都想過「這篇一句話怎麼講」——舊站 28 篇一篇摘要都沒有，列表、meta、RSS 全在裸奔。

### 可用的 MDX 元件

```mdx
import Video from '@/components/media/Video.astro';
import MissingImage from '@/components/mdx/MissingImage.astro';

<Video entry="castle-tower" />
<MissingImage original="https://…" hint="2015 新加坡 Sundown" />
```

`MissingImage` 渲染成一塊留白佔位（虛線框 + 淡墨「闕」字）。在水墨語境裡「缺一張圖」是可以被設計的 —— 比破圖 icon 好，也比偷偷刪掉誠實。

## 加一條輿圖

不要手寫 yaml，用匯入腳本 —— 它會算出真實的距離與爬升，並產生路線 SVG 與海拔剖面。

```bash
pnpm gpx ~/Downloads/race.gpx \
  --slug whistler-utmb-100k-2026 \
  --name '威士拿 UTMB 100K' --nameEn 'Ultra Trail Whistler by UTMB 100K' \
  --realm run --region '卑詩 · 威士拿' --date 2026-08-22 \
  --badge 'UTW · 100K · 2026' \
  [--elapsed PT21H47M] [--result '完賽'] [--note '…'] [--dry]
```

產出三個檔：

```
src/content/routes/<年>/<slug>.yaml         數據
src/content/routes/<年>/<slug>.svg          路線輪廓（~780 點，給路線頁）
src/content/routes/<年>/<slug>.thumb.svg    粗簡版（~72 點，給卡片）
src/content/routes/<年>/<slug>.profile.svg  海拔剖面
```

> 縮圖分兩級是量出來的：四張 800 點的詳圖把首頁 gzip 從 5.0 KB 灌到 18.2 KB。卡片只有 92px，用不到那個精度。

支援 `<trkpt>`（軌跡）與 `<rtept>`（路線，GaiaGPS 匯出的格式）兩種。

**爬升演算法**用遲滯門檻（5m）而不是直接加總正高差 —— 後者會被 GPS 噪音灌水 2–3 倍。外部校準：UT Whistler 100K 官方 100 km / 5,400 m，本管線算出 **100.5 km / 5,372 m，差 0.5%**；Sinister 7 百英里算出 160.5 km（100 mi = 160.9 km）。

路線頁會標註「數據由軌跡檔計算，非賽事官方公布值」。

## 加一支影片

先把檔案轉好上 R2，再寫條目：

```bash
ffmpeg -i in.mov -c:v libx264 -crf 21 -preset slow -pix_fmt yuv420p \
       -movflags +faststart out.mp4          # faststart 必須：moov 移到檔頭
ffmpeg -i out.mp4 -ss 2 -frames:v 1 -q:v 3 poster.jpg
rclone copy out.mp4 r2:zhuiyunzhuxue-media/video/<id>/
```

```yaml
# src/content/reel/<年>/<slug>.yaml
title: 'Metal Dome Ski Touring'
id: metal-dome            # → https://media.jackywu.ca/video/metal-dome/1080p.mp4
poster: ./poster.jpg
posterAlt: '雪脊上的滑降線'
duration: 214             # 秒
bytes: 32900000           # 用來顯示「約 32 MB」
ratio: '16/9'
realm: snow
date: 2026-02-08
```

`<Video>` 用 `preload="none"` —— 預設的 `metadata` 會對每支影片各發一次跨網域 range request，一頁三支就是三次往返。這樣做，影片頁的初始成本＝三張 poster 圖。

## 標籤

標籤同時從文章與行跡取（行跡用行當名與拆開的地名），否則行跡永遠不會出現在任何標籤下。slug 化時空白轉連字號，中文保留漢字。
