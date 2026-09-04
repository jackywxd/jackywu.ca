# 舊站遷移

舊站是 2022 年 12 月停更的 `tailwind-nextjs-starter-blog`（Next 12→14 升級做到一半沒提交、Contentlayer 已停止維護）。frontmatter 是九年三代工具疊出來的沉積層：Gatsby → Contentlayer → 半改的 Next。

## 原則

**腳本只做機械轉換，編輯判斷全部交給人。** 哪篇留、怎麼翻譯、歸哪個行當 —— 這些寫在 `migration-decisions.yaml` 由你填。腳本不代決。

四階段全部 idempotent，都支援 `--dry-run`。

```bash
node scripts/migrate/1-inventory.mjs        # 清點 → manifest + decisions 骨架
#   ↑ 填 migration-decisions.yaml 的 action / realm / slug / date / excerpt
node scripts/migrate/2-normalize.mjs        # frontmatter → 新 schema，寫出新檔
node scripts/migrate/3-media-and-links.mjs  # 圖片落地、失連稽核、連結改寫
node scripts/migrate/4-emit-redirects.mjs   # → public/_redirects
```

> 方案原本把「媒體」與「連結」分成兩階段，這裡合併 —— 它們改的是同一批檔案的正文，分開只是多讀寫一輪。

環境變數：`OLD_SITE`（預設 `~/repos/jackywu.ca`）、`LIVE_ORIGIN`（預設 `https://www.jackywu.ca`）。

## 清點推翻的三個前提

規劃階段的探勘給了三個結論，實地清點全部推翻。這是為什麼第一階段要**實測**而不是相信描述。

### 一、不是「28 篇 100% 英文、零 CJK」

〈**Vancouver Marathon 2019**〉有 **2,770 個中文字（占 59%）** —— 一篇完整的中文賽記，寫他第一次 BQ、3 小時 18 分完賽。這篇幾乎可以原樣進時光機。

（它是繁簡混排，見下方「繁簡正規化」。）

### 二、遠端熱鏈不是「幾乎全死」

21 個 `googleusercontent.com` 熱鏈**全部還活著**（實測 200/206）。

但仍然**全部下載落地** —— 熱鏈到別人的 CDN，現在能開不代表明年能開，而且那是 Google 相簿不是圖床。

### 三、日期錯的不是 2 篇是 4 篇

| 文章 | frontmatter | 資料夾 |
|---|---|---|
| Guangzhou Marathon | 2018-05-01 | 2015-12-06 |
| HongKong Marathon | 2018-05-01 | 2016-01-17 |
| Super marathon | 2019-11-03 | 2019-06-30 |
| Hi-Phone | 2022-04-12 | 2022-04-01 |

只有前兩篇是明確的匯入錯誤（同一個 `2018-05-01` 打在兩篇上）。後兩篇是判斷題 —— 腳本預填資料夾日期並標旗標，**不自動當成錯誤修掉**。

## 其他清點結果

| | |
|---|---|
| 檔案 | 28（25 `.mdx` + 3 `.md`） |
| 舊站實際建置 | 25 —— **3 篇 `.md` 從未上線**（舊站的 glob 只吃 `.mdx`），實測確認回 404 |
| 標了 draft | 4，**且四篇線上都回 200** —— 草稿其實一直是公開的 |
| slug 撞號 | 3 篇共用 `pi-vpn-wifi-ap-and-vpn-gateway` |
| 本地圖 | 25 |
| 遠端熱鏈 | 21 |

`liveStatus` 是對 `https://www.jackywu.ca` 逐一發請求量到的，不是推測 —— 轉址表只該收真的還活著的 URL。

## 三個會靜默損壞內容的 bug（過程中修掉）

1. **slug 撞號會靜默覆蓋。** 三篇會寫進同一個目錄互相覆蓋，最後只剩一篇。修法：撞號時改用標題衍生，並在寫檔前**硬性斷言唯一**、撞了整批中止
2. **連結改寫掃到 frontmatter**，把 `legacy.url` 從舊網址改成新網址 —— 轉址表的來源自己沒了。修法：frontmatter 與正文分開處理
3. **`_redirects` 欄寬用固定值**，目標超長時狀態碼會黏上去讓整行失效。修法：欄寬取實際最大值，並驗證每行都是三欄

## 繁簡正規化

舊文是繁簡混排，而站上用的是思源宋體 TC / 霞鶩文楷 TC，**簡體專有字形不在字型裡**，會靜默退回系統字。

[`scripts/lib/s2t.mjs`](../scripts/lib/s2t.mjs) 只轉**一對一無歧義**的字。有歧義的（`发`→發/髮、`干`→乾/幹/干、`里`→裡/里、`后`→後/后）**刻意不收** —— 那些要看上下文，機器猜錯比不動更糟。

零寬字元（U+200B 等）一併清掉。這一步一開始只在含中文的文章上跑，漏掉了英文文裡的那一個 —— 零寬字元跟語言無關。

## GPX 升格

舊站把軌跡當 `/static/files/` 附件。新站的軌跡是 `routes` collection 的一級條目（有路線圖、海拔剖面、統計），所以文章連過去而不是連檔案。

這是[斷鏈檢查](verification.md#二內部斷鏈)抓到的。

## 「靜」的處理

紀念亡妻那篇（`/blog/2020/2020-08-28`）預設標為 `HOLD`，腳本**不做任何自動處理**，並在轉址階段明確警告「它線上仍是 200，切網域後會變 404」，但不代決。

實際決定是以 `realm: still` 遷入。schema 的 `.refine()` 強制 `shareable: false`，實測驗證：無 `og:image`、無 `twitter:card`、無微信首圖、無分享面板、不在時光機、不渲染標籤，JSON-LD 只剩 `Article` + `headline/inLanguage/url`。

摘要用他自己標題的字，不讓機器推導也不標 `TODO` —— 那個語氣放在這裡不對。

## 結果

29 篇 tales（28 遷移 + 1 原生）、4 條輿圖、**29 條轉址**。

25 條文章轉址在正式網域逐條實測 301 且 `location` 正確（含來源帶 `%20` 的那幾條）。

時光機顯示「4 條行跡 · 7 篇文章」—— 18 篇技術文歸 `forge`，**全部保留、全部 301，但不進時光機、不進導覽**。301 到 404 比「中文站上有篇英文舊文」糟得多。

## 待辦

遷移出來的 27 篇摘要是機器推導的，都帶著 `# TODO 待你改寫` 標記。跑步／戶外那幾篇還需要改寫成中文。
