# 驗證

原則：**驗證那個東西本身，不驗證它的代理指標。** 建置成功不等於站是對的。

這個站有三支 postbuild 檢查，任一不過就讓建置失敗。它們檢查的都是**靜默失效**的東西 —— 頁面看起來正常，只有在特定條件下才發現壞了。

```
postbuild = verify-fonts --strict && verify-links --strict && verify-wechat --strict
```

## 一、字型缺字

[`scripts/verify-fonts.mjs`](../scripts/verify-fonts.mjs)

掃 `dist` 的所有 HTML，找出「實際渲染出來、但不在子集裡」的中文字。

漏字**不會變成豆腐塊**（有系統字兜底），所以沒有這支檢查就是看不出來的靜默降級。子集化掃的是原始碼，這支掃的是真正送到瀏覽器的東西 —— 補上那個缺口。

另有一支在 [`build-fonts.mjs`](../scripts/build-fonts.mjs) 內：用自寫的 TTF cmap 讀取器逐碼位驗證 `poster.ttf`，因為 **satori 缺字是靜默的**（不報錯、直接畫空白）。

## 二、內部斷鏈

[`scripts/verify-links.mjs`](../scripts/verify-links.mjs)

掃所有 `href` / `src`，確認 `dist` 裡真的有對應檔案。斷鏈在靜態站是靜默的 —— 建置成功不代表連結通。

目前：97 頁、1,530 個站內連結、零斷鏈。

它抓到過的真問題：

- Castle Tower 那篇還連著舊站的 GPX 檔路徑（該連到升格後的輿圖條目）
- 「靜」的文章仍渲染標籤連結，但標籤索引本來就排除它，那些連結必然 404

## 三、微信首圖

[`scripts/verify-wechat.mjs`](../scripts/verify-wechat.mjs)

對每個宣告了 `og:image` 的頁面，檢查 `<body>` 裡第一張 `<img>` 是 600×600 的 `/wx/` 圖、非 lazy、非 srcset、非 WebP。

這四條[錯一條微信就抓不到圖](sharing.md#微信-300300-首圖四條規則)，而且完全靜默：頁面看起來正常，只有分享出去才發現縮圖是空的。

## 探針必須能報出兩種答案

一個永遠回「沒問題」的檢查器，跟沒有檢查器是一樣的 —— 而且更糟，因為它給人虛假的安心。上面三支都做過反向驗證：

```bash
# 字型：注入四個子集外的字
python3 -c "import pathlib;p=pathlib.Path('dist/index.html');p.write_text(p.read_text().replace('</main>','<p>饕餮鼯鼱</p></main>'))"
node scripts/verify-fonts.mjs        # → 列出四個字與碼位

# 斷鏈：注入不存在的連結
# → 列出 /tags/… 與 /search/

# 微信：把 fetchpriority 換成 loading="lazy"
# → 「縮圖用了 loading="lazy"（移出視窗的 lazy 圖永遠不會載入）」
```

同樣的道理用在別處：

- **GPX 爬升演算法**第一版對兩條完全不同的賽道都回 `254 m`。**同一個讀數出現兩次就是儀器沒接上** —— 我的遲滯邏輯在第一次下坡後把累加永久關掉了。修好後拿官方數據校準：UT Whistler 100K 官方 100 km / 5,400 m，算出 100.5 km / 5,372 m，**差 0.5%**
- **Pagefind 中文搜尋**：`威士拿` 5.84、`冰川` 4.22、`Duffey` 2.05，而 `鯨魚壽司`、`zzzznotfound` 都回 **0**。`鯨魚壽司廿` 有 1 個結果是因為 `廿` 真的出現在日期「八月廿二日」裡，分數落在地板值 1.19 —— 正確的分詞行為，排序有壓下去
- **開場動畫**驗了兩個方向：首次進站 `data-intro` 存在且三個動畫註冊；第二次 `data-intro` 消失、0 個動畫、`clip-path: none` 內容完整顯示。第二個方向特別要驗，否則狀態沒清乾淨時內容會被裁住看不見

## 儀器本身也可能壞

這個專案裡至少三次差點被壞掉的儀器誤導：

1. **瀏覽器面板的截圖會回傳滯後的空白畫格**。差點因此去改沒壞的 scroll-driven 動效。用 `document.elementFromPoint()` 才確認頁面其實正常
2. **檢查腳本自己寫錯**：驗證路線 SVG 時，我剝掉 `<svg>` 標籤時連帶剝掉了上面的 `fill="none"`，路徑回退成填黑，看起來像產物壞了。**產物是對的，探針是壞的**
3. **粗糙的簡體字清單過度回報**：`里`、`走`、`表`、`角`、`演` 在繁體裡本來就是正字

## 部署後對真實 URL 驗

不是對 build log。

```bash
U=https://jackywu.ca
curl -sI "$U/" | head -1
curl -sI "$U/definitely-not-a-page/?cb=$RANDOM" | head -1   # 必須是真的 404
curl -sI "$U/fonts/…woff2" | grep -i cache-control          # immutable
curl -s -o /dev/null -w '%{size_download}\n' -H 'Accept-Encoding: br' "$U/"
```

> **加 cache buster**。Cloudflare 邊緣會把「頁面還不存在」時的 404 快取住，之後就算部署好了仍回 404。

轉址要**逐條**驗，不是抽樣 —— 見 [部署](deployment.md#_redirects)。

## 目前的門檻

| | 目標 | 現況 |
|---|---|---|
| 頁面 | — | 97 |
| 首頁傳輸 | < 100 KB | 9.7 KB gzip |
| 阻塞渲染路徑 | — | HTML + CSS ≈ 13 KB |
| 自有 JS | < 15 KB gzip | 內聯，文章頁 ~0.7 KB |
| 中文字型 | < 800 KB warn / 1.2 MB fail | 545 KB |
| 斷鏈 | 0 | 0 |
| 微信首圖合規 | 100% | 27/27 |
