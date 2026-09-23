# 部署

## Cloudflare Workers static assets

純靜態 Astro 站**不需要 adapter**。

```jsonc
// wrangler.jsonc
{
  "name": "hongchen-inn",
  "compatibility_date": "2026-09-03",
  // 沒有 "main" ⇒ 純資產 Worker ⇒ 不需要 adapter，也不能有 assets.binding
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page",      // 讓 dist/404.html 回真的 404
    "html_handling": "auto-trailing-slash" // /keeper → 307 → /keeper/
  },
  "observability": { "enabled": true },
  "routes": [
    { "pattern": "jackywu.ca",     "custom_domain": true },
    { "pattern": "www.jackywu.ca", "custom_domain": true }
  ]
}
```

```bash
pnpm build && pnpm deploy
```

### 額度

| | |
|---|---|
| 檔案數 | 免費 20,000 / 付費 100,000（目前 263） |
| 單檔 | 25 MiB（所以影片必須走 R2） |
| `_redirects` | 靜態 2,000 + 動態 100（目前 29） |
| `_headers` | 100 條規則（目前 8） |

## 網域切換

**前提**：zone 必須在 Cloudflare 帳號下（Worker 自訂網域與 R2 自訂網域都要求）。

⚠️ **從別的平台搬 zone 過來時，舊的 A 記錄會被一併匯入。** 那些記錄開著橘雲代理，優先序蓋過 Worker route —— 結果是自訂網域「註冊成功」但請求還是被轉去舊源站。

> **不只 apex。** wildcard `*` 記錄會蓋掉每一個子網域，包括 R2 的
> `media.jackywu.ca`。打一個隨機子網域就知道：
> `curl -s "https://zzz-$RANDOM.jackywu.ca/"` 有回應就是 wildcard 在攔截。

診斷方式（一比就清楚）：

```bash
for h in jackywu.ca www.jackywu.ca hongchen-inn.<subdomain>.workers.dev; do
  printf '%-46s %s\n' "$h" "$(curl -sI https://$h/ | grep -i '^server' | cut -d' ' -f2)"
done
```

`workers.dev` 回 `cloudflare`、正式網域回 `Vercel` ⇒ DNS 記錄在擋路。**修法**：在 Cloudflare 控制台 DNS 刪掉指向舊源站的 A/AAAA 記錄（MX、TXT、CAA 不要動），Cloudflare 會自動補上指向 Worker 的記錄，然後重跑一次 `pnpm deploy` 確立綁定。

wrangler 的 OAuth token 只有 workers 權限，**改不了 DNS** —— 這樣是對的，DNS 變更該經過人。

### apex vs www

以 `jackywu.ca` 為 canonical（分享文案短、海報上乾淨），`www` 301 到 apex。這條用 zone 層的 **Redirect Rule**（免費、不吃 `_redirects` 額度），因為 `_redirects` **比對路徑不比對主機名**。

## `_headers`

```
/*                     安全標頭 + CSP
/_astro/*              immutable, 1y      ← 內容雜湊
/fonts/*.woff2         immutable, 1y
/og/* /wx/* /share/*   1h + swr 1d        ← 改文後最多 1 小時同步
/*.html                max-age=0, must-revalidate
```

**CSP 最容易漏的兩條**：

- `img-src` 與 `media-src` 都要列 `https://media.jackywu.ca`，否則 R2 上的影片與 poster 會被自己的 CSP 擋掉
- `script-src` 要有 `'wasm-unsafe-eval'`，否則 Pagefind 的 WebAssembly 起不來

`'unsafe-inline'` 是必要的（Astro 的 scoped `<style>` 與防閃白的 inline script）。要用 nonce 就得有 Worker script 動態注入，那就不再是純靜態了。這是個沒有使用者輸入、沒有第三方腳本的靜態站，接受它。

## `_redirects`

由 [`scripts/migrate/4-emit-redirects.mjs`](../scripts/migrate/4-emit-redirects.mjs) 產生，**不要手改**。

兩條硬規則：

1. **只輸出實測 `liveStatus === 200` 的來源。** 轉址到一個從來沒上線過的 URL 沒有意義
2. **來源一律 percent-encode。** `_redirects` 以空白分欄，寫成真空白會讓整行失效

驗證每一條（不是抽樣）：

```bash
while read -r from to code; do
  R=$(curl -sI -o /dev/null -w '%{http_code}' "https://jackywu.ca$from")
  L=$(curl -sI "https://jackywu.ca$from" | awk '/^location:/{print $2}' | tr -d '\r')
  [ "$R" = "301" ] && [ "$L" = "$to" ] || printf '✗ %-42s %s → %s\n' "$from" "$R" "$L"
done < <(grep -v '^#' public/_redirects | grep '^/blog/' | awk '{print $1,$2,$3}')
```

## 本機驗證部署行為

```bash
pnpm build
pnpm serve      # wrangler dev —— 真的 Workers runtime
```

**不要用 `pnpm preview`** 驗證部署 —— Astro 的靜態伺服器完全不理 `_headers` 與 `_redirects`。

## R2（影片）

```
bucket zhuiyunzhuxue-media（位置提示 WNAM）→ 自訂網域 media.jackywu.ca
物件 key：video/<id>/1080p.mp4 + poster.jpg
上傳帶 --cache-control "public, max-age=31536000, immutable"
Zone Cache Rule：media.jackywu.ca/* → Edge 1y / Browser 30d
```

**為什麼 R2 不是 Stream**（20 支 5 分鐘 1080p、約 4GB）：

| | Cloudflare Stream | R2 |
|---|---|---|
| 儲存 | 4–5 個 rendition → ~450 分鐘 → $2.25/月 | 4GB × $0.015 = $0.06/月 |
| 傳輸 | $1 / 1000 播放分鐘 | **$0（零流出費）** |
| 最低消費 | **$5/月** | 無 |

差約 80 倍，而 Stream 換來的 ABR/DRM 這個站一項都不需要。

## CI

建置步驟只寫一份，在 [`.github/actions/build`](../.github/actions/build/action.yml)：
install → `astro check` → `pnpm build`（含 postbuild 五個驗證）→ 產物斷言。
兩個 workflow 都呼叫它，所以 PR 驗過的就是會上線的：

| workflow | 觸發 | 做什麼 |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | PR、手動 | build → `wrangler versions upload`（上傳但不接管流量）→ 預覽網址貼回 PR。同一 PR 有新提交就取消舊的那次 |
| [`deploy.yml`](../.github/workflows/deploy.yml) | push main、手動 | build → `pnpm exec wrangler deploy`。**部署不中途取消**：上傳一半的資產比舊版更糟 |

### E2E 與上線 smoke（[`e2e/`](../e2e/)，Playwright）

測的是訪客真的會做、而且壞了**看不出來**的事。每一支都在檔頭寫了它防的是哪種失敗、
為什麼需要瀏覽器；每一支都反向驗過（故意弄壞 → 看它為那個理由變紅）。

| project | 對象 | 什麼時候跑 |
|---|---|---|
| `ci` | `wrangler dev` 跑剛建好的 `dist/` —— 與線上同一套 `_headers`（CSP）、`_redirects`、404 處理 | PR 與部署前，都在共用的 build action 裡。**E2E 不過就不部署** |
| `prod` | https://jackywu.ca。先等線上換成這一版（比對雜湊資產檔名），再跑 `@smoke` 與只有線上才有的檢查 | `wrangler deploy` 之後 |

不用 `astro dev` / `astro preview` 跑 E2E：它們不套用 `_headers`，在上面綠燈證明不了 CSP 沒擋掉搜尋。
沒有 retries；逾時預算在 [`e2e/budgets.ts`](../e2e/budgets.ts)，數字來自實測分布。
smoke 失敗不會自動回滾 —— 回滾要人判斷：`pnpm exec wrangler rollback`。

```bash
pnpm test:e2e     # 重新建置，再對 wrangler dev 跑
pnpm test:smoke   # 對線上跑（需要本機有 dist/，用來比對線上是不是這一版）
```

wrangler 用 lockfile 鎖住的那一版，跟本機同一版。需要兩個 repo secrets：
`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。

預覽網址不一定有：`routes` 用了 `custom_domain`，wrangler 因此預設關掉 `workers_dev`，
`preview_urls` 沿用帳號端的設定。沒開的話 PR 留言會照實說，不會貼一個空連結。

API Token 最小權限：`Workers Scripts: Edit` + `Zone Workers Routes: Edit`。**不要用 Global API Key。**

## 大陸訪問

Cloudflare 從大陸常被路由到美國，延遲 1 秒以上、偶爾超時。既定的取捨是接受它，補償方式是把首屏壓到極輕：**HTML + CSS ≈ 13 KB 阻塞路徑**，字型走 `font-display: swap` 不擋首次繪製。`siteUrl` 抽在 [`lib/site.ts`](../src/lib/site.ts) 單一常數，日後要出鏡像只改一處。
