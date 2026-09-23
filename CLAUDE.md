# jackywu.ca — 紅塵客棧

繁體中文為主的個人站。Astro 7 靜態站，部署在 Cloudflare Workers static assets。
主題是跑步、滑雪、摩托、探險，表現形式是一條年份時光機。

完整文件在 [docs/](docs/)：[架構](docs/architecture.md) ·
[設計系統](docs/design-system.md) · [內容模型](docs/content.md) ·
[寫作](docs/authoring.md) · [MDX 元件](docs/components.md) · [分享](docs/sharing.md) · [部署](docs/deployment.md) ·
[驗證](docs/verification.md) · [已知的坑](docs/gotchas.md)

## 常用指令

```bash
pnpm dev          # 開發（會先重切字型子集）
pnpm build        # 建置 + 五個 postbuild 檢查
pnpm new          # 開新文章（--date 決定年份資料夾，CJK 標題必須給 --slug）
pnpm sync         # R2 媒體雙向同步
pnpm test:e2e     # 建置後對 wrangler dev 跑 E2E（CI 與部署前都會跑）
pnpm test:smoke   # 對線上 jackywu.ca 跑 smoke（部署後自動跑）
pnpm exec wrangler deploy
```

## 不可退讓的幾條

**postbuild 的五個檢查必須全綠才能部署。**它們是
`verify-fonts` · `verify-links` · `verify-wechat` · `verify-og-crop` · `verify-docs`。
每一個都對應一次真實的線上事故，不是形式主義。要停掉某一個，先說清楚理由。

**新增檢查必須反向驗過。**造一個已知會壞的輸入，確認它 `--strict` 回 exit 1。
不會報錯的檢查等於沒有檢查——`verify-wechat` 早期只掃「已經有 og:image 的頁面」，
於是缺 og 的頁面天生不在視野裡，一路綠燈而首頁分享出去是空卡。

**不要為了診斷而寫程式。**要答案就去讀決定行為的那個檔案：schema、
`node_modules` 裡的 vendor 原始碼、設定、log。臨時寫的探針第一版幾乎都是錯的，
而壞掉的探針是靜默的——它的沉默會被讀成「沒問題」。

**破壞性操作用提議的，不要執行。**刪除、`git reset --hard`、force push、
對線上環境跑 migration：把指令列出來給人跑，標明哪一步不可逆。

## 這個 repo 特有的坑

完整清單在 [docs/gotchas.md](docs/gotchas.md)，最常咬人的四個：

1. **Lightning CSS 會把 `animation` 簡寫 + `animation-timeline` 併成無效宣告**，
   於是所有捲動驅動動畫在 production 靜默失效（dev 沒壓縮所以看不出來）。
   一律用長寫，`animation-duration` 必須是 `auto`。
2. **satori 的 `div` 一定要有 `display: flex`**，連零子節點的裝飾用 div 也要。
   `h()` 已經統一補上，`...props` 必須放在 `style` 之前。
3. **微信讀 `og:image`，而且置中裁成方形。**版面必須是中軸構圖，
   關鍵內容收在中央 560px 內。`verify-og-crop` 會擋。
4. **`_redirects` 以空白分欄**，來源網址裡的空格必須 `%20`。

## 翻譯

站要做中英雙語，**翻譯在對話裡做，不用腳本**。詞彙表、語氣規則、
不准動的東西，全在 [docs/translation.md](docs/translation.md)——動手翻之前先讀那份。

每翻完一篇，把當場新造的譯法回填進詞彙表。跳過這步，詞彙表三個月後就死了。

## 秘密

`.env`（已 gitignore，範本是 `.env.example`）或 shell 環境變數。
`ANTHROPIC_API_KEY`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。
Cloudflare 的 token 在 GitHub repo secrets。**不要把任何金鑰貼進對話。**
