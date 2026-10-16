# Code review：`feat/admin-m1-deps`（2026-10-16）

範圍：`main...feat/admin-m1-deps`，15 個提交，224 個檔案，約 13,700 行（不含 lockfile 與 migration 快照）。

## 方法

- 分成五塊，各由一個獨立的審查者閱讀：安全與存取、發佈管線、內容轉換、媒體／影片／GPX、編輯器 UI 與測試／CI。
- 審查者只拿到程式碼與需求，沒有拿到寫程式的人（我）的結論。
- 每條結論都對照了我們的程式碼；牽涉框架行為的，對照 `admin/node_modules` 裡 Payload 3.91、Next 16.4.2、Lexical 0.50、@cloudflare/containers 的原始碼。
- 沒有對任何線上環境做操作。

**標記：**
- **已核對**：我自己重新讀過程式碼確認。
- **讀碼確認**：審查者讀碼（含 vendor 原始碼）確認，我沒有重讀。
- **探針確認**：審查者用暫存的測試實際跑出結果。
- **未證實**：要線上環境或儀表板設定才能確定，並寫出怎麼確認。

## 總評

**不能上線。**本機測試全綠（admin vitest 641、parity、前台建置＋五項檢查＋E2E 12、admin E2E 30），但測試沒有涵蓋下面這幾類問題。原因有三：
- E2E 以 dev bypass 的 owner 身分執行，沒走過 CI 服務憑證（reader）的路徑。
- 假的轉碼服務沒有模擬真容器的任何限制。
- 新的 workflow 一次都沒有在 GitHub 上跑過。

問題最集中的四個地方：
1. 發佈管線的併發與失敗路徑；
2. 草稿的讀取權限；
3. 影片轉碼在正式環境根本跑不起來；
4. 編輯器有好幾條會丟資料的路徑。

另外有兩件事是我先前說錯、要更正的，見文末〈我先前說錯的地方〉。

---

## P0：上線前必須修（9 項）

### 1. `deploy.yml` 用 git 內容重建整站，蓋掉後台發佈的內容；同時關掉完整性護欄 —— 已核對

- **位置：**
  - `.github/workflows/deploy.yml:3-14,26-31`
  - `.github/actions/build/action.yml`（`pnpm build` 沒帶 `CONTENT_SOURCE`）
  - `src/content.config.ts:10`
- **情境：**後台發佈了文章 A。之後任何一次 push main（只略過 `content-backup/**`、`admin/**`），`deploy.yml` 都會用 `src/content/tales` 重建並部署，A 和所有後台發的文章就從線上消失。
- **連帶問題一：**`deploy.yml` 不產生 `content-manifest.json`。下一次發佈拿到 404，把它當成「第一次部署」，於是 `fetch-content.mjs:75` 跳過完整性護欄。
- **連帶問題二：**兩個 workflow 共用 `concurrency: deploy-production`，排隊中的 run 會被新進來的取消。發佈請求被取消時，看門狗會重送；但被取消的程式碼部署沒有人重送。

### 2. CI 與轉碼用的服務憑證讀得到所有草稿版本 —— 已核對

- **位置：**
  - `admin/src/collections/{Tales,Pages,Routes,Reels}.ts`：都沒有設 `readVersions`。
  - `admin/node_modules/payload/dist/auth/executeAccess.js:18`：沒設時 `if (req.user) return true`。
  - `admin/src/lib/access-strategy.ts:32-33`：服務憑證被當成 `reader` 使用者。
- **情境：**拿 GitHub 上的 `CF_ACCESS_CLIENT_*` 或轉碼 Worker 的憑證打 `GET /api/tales/versions?limit=0`，就能讀到所有從未發佈的草稿全文。
- **影響放大的因素：**repo 是公開的，而 `publish.yml:21-25` 把這組憑證放在 workflow 層級的 env，所以 `pnpm install` 的 lifecycle script、astro、sharp、playwright 全都拿得到。
- **注意：**`scripts/lib/live-source.mjs:29` 讀指定版本的功能就是靠這個漏洞運作的。修的時候要改成「reader 只能讀處於 dispatched 狀態的發佈請求所綁定的那幾個 versionId」。
- **同類問題：**`Media` 用 `readAnyAuthed`，reader 能下載所有私有媒體檔，包括只在草稿裡出現的圖。

### 3. 發佈／撤下／刪除端點沒有 CSRF 防護 —— 程式碼已核對；能否被利用未證實

- **位置：**
  - `admin/src/endpoints/publish.ts:21-34`：不看 content-type，直接 `JSON.parse(req.text())`。
  - `admin/src/lib/access-strategy.ts`：不檢查 `Origin`／`Sec-Fetch-Site`。
  - `admin/src/payload.config.ts`：沒有設 `csrf`。
- **情境：**本人登入後瀏覽了一個惡意頁面。那個頁面送一個 `text/plain` 的 POST 到 `/api/publish/request`，內容是 `{"collection":"tales","docId":"7","kind":"publish"}`。這是不需要 preflight 的 simple request，於是任何草稿都會被發佈出去，或者被排進刪除。
- **能否被利用取決於：**Access 的 `CF_Authorization` cookie 的 SameSite 設定（Cloudflare 預設是 None）。到 Zero Trust 儀表板看這個 application 的 cookie 設定即可確認。
- **為什麼只靠 SameSite 不夠：**`jackywu.ca` 和 `staging.jackywu.ca` 與後台同站（same-site），前台的 CSP 又有 `script-src 'unsafe-inline'`。
- **修法：**在 strategy 或端點拒絕所有 `Origin` 不是後台的非 GET 請求。

### 4. 公開媒體的生命週期有兩個洞 —— 已核對

- **洞一：發佈失敗時，已經 promote 的影片和 GPX 永遠留在公開 bucket。**
  - promote（`publish.yml:111-118`）排在 deploy 和 smoke 之前；失敗回呼（`packages/content-sync/ci.ts:63-70`）不帶 `promoteKeys`。
  - 所以這些 key 不會進 `promoted` 表，之後撤回也找不到它們。結果是未發佈的影片永久公開，而且帶著 `immutable, max-age=31536000`。
- **洞二：`promoted` 表記的是整份 manifest，不是這次實際複製的 key。**
  - 位置：`scripts/ci-callback.mjs:23`（`promoteKeys: manifest.promoteKeys`）。`promote-run.ts` 回傳的 `copied` 清單只印出來，然後就丟掉了。
  - 結果：git 時代用 `pnpm sync` 傳上去的公開檔，也會被記成「pipeline 自己 promote 的」，之後撤下時就會被刪掉。
  - **未證實：**git 時代的檔案在私有 bucket 裡是否都還有一份。如果公開端是唯一的一份，刪了就救不回來。確認方法：列出兩個 bucket 的 `video/`、`gpx/`。
- **相關問題：撤回上限的算法有三個毛病**（`promote.ts:39-40`）。
  - 上限是 `max(1, floor(0.2×新 manifest 數量))`。撤下一支影片要刪 2 個 key（mp4＋poster），所以 key 少於 10 個時，每次撤下都會中止。
  - manifest 是空的時候，完全沒有上限。
  - 中止時 `process.exit(0)`，寫一個沒有人讀的 `revoke-aborted.txt`。回呼照樣回報成功，不會寄信。runbook 寫的「後台顯示警告」並不存在。

### 5. 看門狗與狀態輪詢會讓「網站已上線」和「Payload 說沒上線」兩邊不一致 —— 已核對

- **問題一：看門狗會判死還在跑的 run。**
  - `publish-queue.ts:118-123`：結論是 `in_progress` 的 run，會一路走到「距離 dispatch 超過 25 分鐘」那條判斷，然後被標成失敗。
  - 計時從 dispatch 開始，所以在 concurrency 群組裡排隊等待的時間也算進去，例如前面卡著一個 20 分鐘的 `deploy.yml`。
  - 失敗之後 run 才成功，回呼看到請求已經是 `failed`，就回 `applied:false`。結果：線上站有文章 A，Payload 說 A 沒發佈，信裡還說「網站維持上一版」。
- **問題二：前端每 4 秒的輪詢都會跑一次 `sweep`，而且完全沒有鎖。**
  - 位置：`PublishStatus.tsx:50`、`endpoints/publish.ts:42`、`publish-service.ts:63-71`（先讀整列，再整列覆寫，沒有 compare-and-set）。
  - 後果 (a)：被取消的 run 重送之後，GitHub 要幾秒才會建出新的 run。下一次輪詢只看到舊的 cancelled，又重送一次；約 8 秒內用完 3 次，請求被標失敗，但實際上有兩個 run 在排隊。
  - 後果 (b)：拿著舊快照的 sweep，會把 callback 剛寫好的 `deployed` 蓋回 `failed`。
  - 後果 (c)：兩個同時進行的 sweep，可能把同一筆請求 dispatch 兩次。
- **之後會怎樣：**
  - 下一筆如果是新文章，會通過完整性護欄，A 就被靜默撤掉。
  - 下一筆如果是修改舊文，護欄看到篇數少了一篇而擋下。之後每一次修改都被擋，直到又有新文章發佈為止。

### 6. 依賴閉包的三處邏輯各算各的 —— finalize 已核對，其餘讀碼確認

- **finalize 發佈的是最新草稿，不是建置時用的版本。**
  - `publish-service.ts:237-241` 用 `draft: true` 讀 route 或 reel，只要 `_status !== 'published'`，就把最新版本發佈出去。
  - 已上線的 route 如果有一份比較新的草稿，讀出來就是 `draft`，於是那份沒經過建置、也沒經過檢查的草稿被標成 published。
  - reel 的情況更普遍：轉碼狀態每變一次，`video-service.ts:26,49` 就寫一次 draft。
  - 一旦壞掉的草稿被發佈，之後每一次建置都在 `files.ts:152` 失敗，**一個壞依賴擋住所有發佈**。
- **正文裡的 block 只有一處有算進依賴。**
  - `missingDeps`（`request.ts:33-57`）會算進正文裡的 `video`／`route` block。
  - 但 `validateDependencies`（`publish-service.ts:83-110`）和 `finalize`（`:226-235`）只看 frontmatter 的 `doc.video`／`doc.route`。
  - 結果：block 引用的草稿 reel 會被拉進建置而上線，但轉碼完成與否沒有檢查，之後也不會被標成 published。
  - 接著，下一次撤下或刪除會在 `files.ts:95/99` 失敗，每週備份也會在 `export.ts:59-60` 失敗。
- **從沒發佈過的 route 或 reel，CI 可能根本讀不到。**`live-source.mjs:32` 的 `?draft=true` 加上 reader 的 `_status=published` 條件，查詢的是主表那一列，而主表那一列是 `draft`，所以回 404，fetch-content 就失敗。
  - **未證實：**要在線上用一篇引用新路線的文章跑一次才能確認。
- **修法：**只寫一個函式，從 frontmatter 和正文 block 一起算出依賴。驗證、fetch、finalize 三處都用它，並且釘住建置當下的 versionId。

### 7. 影片在正式環境跑不起來 —— 綁定已核對，其餘讀 vendor 原始碼確認

- **綁定：**`admin/wrangler.jsonc` 的頂層和 staging 都沒有 `TRANSCODER` service binding，只有 e2e 有。`kick()` 會回 `no-transcoder`，reel 永遠停在 `queued`，畫面上也不會出現任何錯誤。
- **容器會被提早停掉：**`transcoder/worker/index.ts:13` 設了 `sleepAfter = '10m'`。
  - `/run` 回 202 之後，就沒有請求再進來續命，所以第 10 分鐘 ffmpeg 會被停掉。
  - `server.mjs` 沒有處理 SIGTERM，這件事不會被回報。
- **成品上傳會被擋：**成品 MP4 是一次 PUT，經過 `admin.jackywu.ca` 這個 proxied 網域，所以受 request body 上限限制（約 100MB）。1–2 分鐘的影片就會 413，三次之後標成失敗。
- **看門狗分不出慢和死：**30 分鐘的看門狗（`video-job.ts:3`）無法區分「慢」和「死」，但 token 的有效期卻是 4 小時。
  - 超過 30 分鐘的工作會被重派；新的 kick 打到同一個容器拿到 409，原本那次的成果被拒收。
- **重試吃掉錯誤訊息：**立即重試一定撞 409（`server.mjs` 是在 report 之後才清 `busy`），並把真正的 ffmpeg 錯誤訊息覆蓋掉。
- **測試為什麼沒抓到：**假的轉碼服務沒有模擬 409、`sleepAfter`、body 上限，所以這幾條都沒被 E2E 抓到。

### 8. 編輯器吞掉載入後的第一次編輯 —— 讀 vendor 原始碼確認

- **位置：**`admin/src/editor/Editor.tsx:51,78-82`。程式用一個 `first` ref，把第一次 `onChange` 當成「載入本身」略過。
- **為什麼會吞掉：**`@lexical/react/src/LexicalOnChangePlugin.ts` 本身已經略過 `prevEditorState.isEmpty()` 和 history-merge 這兩種更新，所以載入根本不會觸發 onChange。被略過的其實是使用者的第一個真正編輯。
- **情境：**打開舊文，只做一次單一更新（貼上一段、插入一個 block、輸入法一次送出的修字），然後按發佈。`flush()` 看到的是 `saved`，於是發佈的是舊版，重新整理後那次修改不見了。
- **測試為什麼沒抓到：**E2E 每次都打很多字。
- **還沒做：**在瀏覽器裡實際觀察。修的時候先寫「單次編輯 → 重新整理」的失敗測試。

### 9. 巢狀清單靜默遺失 —— 探針確認、已核對

- **位置：**`packages/content-sync/lexical.ts:100-106`。
- **兩種遺失：**
  - 清單項裡只有子清單、而且是第一項時，子清單整個不見。
  - 清單項裡同時有文字和子清單時，子清單被丟掉。
- **嚴重性：**這兩種都不報錯，違反這個模組自己的第一條規則（認不得就失敗）。
- **同類問題：**highlight（格式位元 128）、`style`、表格的 `colSpan`／`rowSpan`、表格裡的標題，也都被壓平或忽略。

---

## P1：高

| # | 問題 | 位置 | 狀態 |
|---|---|---|---|
| 10 | 改 slug 或日期時，轉址由 `afterChange` 在 finalize 之後才寫入，所以舊網址在下一次部署前都是 404。被現有轉址指到的文章一旦改名、撤下或刪除，`verify-links --strict` 永遠失敗，這筆請求永遠發不出去。刪除一篇從未發佈的草稿，會在 `applyRequest` 丟出「本來就不在已上線的內容裡」 | `tale-hooks.ts:33-34`、`request.ts:16-27` | 讀碼確認 |
| 11 | 回呼端點把所有錯誤都回 404，`ci-callback` 把 4xx 視為致命而不重試，暫時的 D1 錯誤就變成永久失敗。另外 Tales 只保留 25 個版本、自動存檔最快 30 秒一次，發佈後連續寫 12 分鐘左右，綁定的 versionId 就會被清掉，finalize 跟著失敗 | `endpoints/publish.ts:66-68`、`Tales.ts:14` | 讀碼確認 |
| 12 | 伺服器端的 GPS 檢查看的是用戶端宣告的 mimetype。宣告成 `application/octet-stream`（在允許清單裡）上傳，就能把帶 GPS 的 JPEG 存進去。另外只檢查 EXIF 的 GPS IFD，不看 XMP，而 import 路徑不重新編碼 | `Media.ts:19,26-28`、`exif.ts` | 已核對 |
| 13 | `downloadable: false` 完全沒有作用：只要有 GPX，就 promote `gpx/<slug>.gpx`，前台也沒有任何地方讀這個欄位。結果是完整軌跡（含時間戳與起點）在可以猜到的網址上公開 | `files.ts:134` | 已核對 |
| 14 | 存檔沒有併發控制，最後寫入的贏。手機離線時寫的內容在恢復連線後會直接蓋掉桌機剛存的版本；並排選擇只在頁面載入時才會出現 | `TaleEditor.tsx:73-90,110` | 讀碼確認 |
| 15 | 在回答「要不要復原本機草稿」之前就開始打字，會覆寫本機備份，而下一次存檔成功會清掉它。山上寫的那份草稿從此只存在記憶體裡 | `TaleEditor.tsx:97-107,188-197` | 讀碼確認 |
| 16 | 新增的四個 workflow 一次都沒在 GitHub 上跑過，`repository_dispatch` 只會從預設分支觸發，所以第一次真正的執行就是 production。沒驗證過的假設包括：`wrangler deployments list --json` 的輸出格式、`rollback --message --yes`、`d1 time-travel info`、Access 服務憑證打回呼。`test:seam` 和 parity 也沒有接進任何 workflow | `.github/workflows/*` | 讀碼確認 |
| 17 | `ci-request.mjs \| tee` 沒有 pipefail，驗證失敗這一步仍是綠的，回呼又以為是手動部署而直接 exit 0。後台什麼都不知道，要等 25 分鐘看門狗 | `publish.yml:40` | 已核對 |
| 18 | 中文字後面的直引號一律被轉成右引號：`他說"你好"` → `他說”你好”`，和 git 模式（satteri）的結果不同。現有 29 篇剛好沒有這種寫法，所以 parity 測不出來，但新文章會碰到 | `html.ts:21` | 探針確認、已核對 |

## P2：中

**發佈管線**

- rollback 失敗，或部署後被手動取消，都會被回報成「網站維持上一版」（`publish.yml:138-144`）。
- dispatch 一直失敗時，每次 sweep 都寄一封信。狀態頁開著的話，大約每 4 秒一封（`publish-service.ts:154-157`）。
- 完整性護欄只數 tales；`redirects` 沒有版本，一旦被改就立刻進入下一次不相干的建置（`fetch-content.mjs:74`）。
- 撤下時寫入的 `_status:'draft'` 會蓋住之後的草稿（`publish-service.ts:245`）。

**安全**

- dev bypass 判斷主機用的是 `x-forwarded-host`。這是用戶端可以控制的 header，萬一 bypass 變數被誤設到線上，就能被利用（`access-strategy.ts:13-14`）。
- 轉碼容器拿到的 Access 憑證權限等於 reader。配上 P0-2，可以讀所有草稿與媒體，和註解宣稱的「只能動這一支影片」相反。
- 一把 HMAC 同時被公開 repo 的 Actions、cron Worker、後台持有，而且簽章不涵蓋 path。所以 cron 的金鑰可以偽造發佈回呼。
- 失敗建置的 log 和 artifact 是公開的，裡面可能帶出草稿的 slug 與連結。
- 前台用 `set:html` 直接輸出存在資料庫裡的 SVG。`admin.readOnly` 只是在 UI 上隱藏，API 照樣可以寫。
- `/\evil.com` 能通過「站內相對連結」的白名單。
- 用一個 zip，宣告幾千個各 80MB 的項目，可以讓 import 的 Worker 記憶體耗盡。
- 後台沒有 CSP 與 `frame-ancestors`（未證實線上的 header）。

**影片／GPX**

- 直式手機影片的比例會存錯，直式 4K 的尺寸超出 H.264 level（未證實，要對真實手機影片跑 ffprobe 確認）。
- 改 slug 之後 promote 失敗；重新轉碼後，公開端仍然是舊檔（`promote.ts:28`）。
- GPX 超過約 12.5 萬點時，`Math.min(...xs)` 會爆堆疊（`gpx-core.mjs:85,105`）。這是舊程式碼，現在改在 Worker 上跑。
- 上傳到一半就關掉分頁，reel 會永遠停在 `uploading`。`video-src/` 的原檔轉碼成功後也不會刪。
- Dockerfile 的 base image 沒有釘 digest，ffmpeg 也沒有限定輸入格式。

**內容轉換**（細節見審查記錄）

- figure 的 `href` 在有圖說或 wide 時，匯出與導入都會遺失。
- Gallery 項目的屬性順序不同就被靜默略過。
- 表格儲存格裡含 `|` 的行內程式碼會切壞儲存格；行內程式碼外面的粗體會遺失。
- 引言開頭是 `- `、`1. `，或段落裡換行後接 `- `、`#`，都會被當成區塊語法。
- `CONTENT_SOURCE=payload` 時，`pages` 仍然讀 git，在後台發佈 page 沒有任何效果。
- 備份的 route YAML 和 git schema 不一致。
- 有序清單的 `start` 會遺失。
- 兩條路徑的 HTML 結構不同（圖片、多段引言、表格 thead、標題 id、外連 `target=_blank`），而 parity 只比純文字，看不到這些差異。

**編輯器**

- 存檔進行中按發佈會被拒絕，訊息還寫成「有圖片還在上傳」（`autosave.ts:76`）。
- 第一次建立的 POST 回應丟失時，重送會再建一篇。
- 在後台內部換頁不會存檔。
- `replaceState` 之後按上一頁，會出現空的編輯器（未證實）。
- 存檔成功時，會把存檔期間新打的備份一起清掉。
- tags 欄位打到分隔符號就被吃掉，打不出第二個標籤。
- 抽屜宣告了 `aria-modal`，但沒有焦點管理和 Esc。手機上的操作列蓋住了分頁列。

## 測試本身的問題（對照 TESTING.md）

- **E2E 全程以 owner bypass 執行。**reader（CI 服務憑證）的讀取路徑從來沒被走過，所以 P0-2、P0-6 都沒被發現。
- **假轉碼服務**沒有模擬真容器的任何限制，所以 P0-7 全數通過 E2E。
- **GPS／大小那條 E2E 斷言的是「最新的一筆媒體」，不是剛上傳的那筆。**上傳是用 sha256 去重的，三個 project 又共用同一個資料庫，所以後面的 project 很可能拿到前面的那一筆，斷言等於檢查了別的檔案、不會失敗（推論，未實跑）。修法：從畫面上的「已選（媒體 N）」取 id。
- **影片 E2E 的標題**寫了「資料不完整時文章不能發佈」，內容卻沒有斷言這件事。
- **`tale-form.test.ts:24-29` 的反向驗證**是把檢查邏輯在測試裡重寫一遍，沒有呼叫真正的檢查。
- **風險最高的邏輯沒有單元測試的切入點。**存檔／建立、復原選擇、清備份、發佈閘門都寫在 `TaleEditor` 元件裡，任何層級都沒有測到。
- **E2E 的逾時**（15／20／30／40 秒）不是量出來的。

## 我先前說錯的地方

- **我加的 slug 探針測不到它的註解說要測的東西。**`journey.e2e.ts:26` 的 `toHaveValue(slug)` 讀的是 DOM 的值。如果是受控 input 沒收到 onChange，DOM 仍會顯示打進去的字，這個斷言照樣通過。
  - 那次「slug 是空的」失敗至今沒有找到機制。審查者排除了伺服器丟值、`replaceState` 造成 remount、本機草稿復原這三種可能。
  - 能真正區分的探針有兩種：關掉再打開設定抽屜（此時欄位由 state 重新算出）再斷言；或在發佈前 GET `/api/tales/<id>?draft=true` 斷言 slug。
- **`docs/runbook-publish.md` 有兩處與實作不符。**
  - 寫了撤回超過 20% 時「後台顯示警告」，實際上不存在。
  - 對應的 Dockerfile 與 `internal-token.ts` 註解宣稱容器「只能動這一支影片」，也不對（見 P2 安全）。
- **之前回報「全部測試通過」是真的，但那不代表能上線。**上面 P0 有一半落在測試看不到的地方。

## 做得好的地方

- **發佈狀態機：**`publish-queue` 很小，佇列順序、回呼冪等、取消重送都有雙向的測試。
- **外來輸入：**一律只經過 env 傳進步驟，再由 `parseRequest` 驗證，不會進到 shell，`verify-workflows` 也做靜態檢查。
- **HMAC：**常數時間比較，時間窗 ±300 秒。
- **JWT：**驗證 JWKS、iss、aud、exp。AUD 或 team domain 是空值時一律拒絕。`GITHUB_API_BASE` 有白名單。
- **promote／revoke：**限定 `video/`、`gpx/` 兩個前綴，逐個 key 刪除，複製後再確認一次公開端真的有。
- **內容轉換：**遇到認不得的節點會丟錯並帶出 slug；HTML 的文字與屬性都有跳脫；匯出的鍵序固定（備份不吵）；草稿不會進備份；`packages/*` 都符合 Node 型別剝除的語法限制。
- **GPX：**`gpx-core.mjs` 與 main 上的 `scripts/lib/gpx.mjs` 完全相同。
- **測試環境：**E2E 封鎖對外請求、每次跑都用全新的 D1／R2、`retries: 0`。

## 建議的修正順序

每一項修正都先寫一個會失敗的測試，看它紅過一次，再修。

1. **止血**（任何真實發佈之前）：
   - `deploy.yml` 在切換到 payload 之後拒絕用 git 內容建置；兩個 workflow 不再共用 concurrency 群組，或改成互相知會。
   - 加上 `readVersions`，並依 `common_name` 對服務憑證分配角色。
   - CSRF：檢查 Origin。
   - secrets 一律縮到 step 層級。
2. **發佈併發：**
   - `publish_requests` 改用 D1 條件更新（compare-and-set）；sweep 只由 cron 執行，輪詢只讀不寫。
   - 看門狗認得 `in_progress`，計時從 run 開始算，不從 dispatch 算。
   - 收到「遲到的成功」時要能補記，不能因為狀態已經是 failed 就丟掉。
   - promote 記實際複製的 key；失敗路徑也要記下來或當場撤回；修正撤回上限的算法，中止時要通知。
3. **依賴模型統一**（P0-6、P1-10、P1-11）。
4. **影片：**
   - 補上綁定。
   - 容器要有心跳或續命機制。
   - 成品改用 presigned multipart 上傳。
   - 看門狗改看心跳，不看總時長。
   - 簽章網址綁定這一次 attempt。
5. **編輯器的資料遺失：**
   - 修正第一次編輯被吞掉的問題。
   - 存檔帶 `updatedAt` 做樂觀鎖。
   - 第一次建立要冪等（或在開新文章時就由伺服器建立草稿）。
   - 把存檔、建立、復原、發佈閘門的邏輯從元件裡抽成可以單元測試的純函式。
6. **內容轉換的各項修正**，每一項都補 golden test；parity 改成比對 HTML 結構，不只比純文字。
7. **接上 CI：**`test:seam`、parity、reader 身分的 contract 測試；在 staging 實際跑一次每個 workflow。

---

## 修正紀錄（2026-10-16）

每一項修正都先寫測試、看它失敗，再修；測試在 PR 上第一次就通過的，另外做過「把修正拿掉、看它變紅」的反向驗證。
**「已修」不等於「線上驗過」**：這個分支沒有部署過，GitHub 上的 workflow 也還沒跑過（見最後一節）。

| 提交 | 範圍 |
|---|---|
| `96f5044` | 止血：內容來源開關、草稿版本存取、CSRF、secrets 範圍 |
| `7a14898` | 發佈佇列的併發與公開媒體的帳 |
| `c9676f4` | 依賴模型統一（快照）、改名與撤下的轉址 |
| `9f6b36d` | 影片管線 |
| `498eaf7` | 編輯器的資料遺失、撤下與刪除 |
| `f019908` | 內容轉換 |
| `d6900c5` | 媒體與 GPX |
| （本次） | CI 接上接縫測試與遷移對照、後台安全標頭、三個不可靠的測試 |

### P0

| # | 狀態 | 怎麼修、怎麼驗 |
|---|---|---|
| 1 | 已修 | repo 變數 `CONTENT_SOURCE` 決定誰部署；`deploy.yml` 只在不是 payload 時部署、`publish.yml` 接手 push；兩者不共用 concurrency 群組；拿不到上次的 manifest 就拒絕（只有手動宣告第一次切換時例外）。`verify-workflows` 新增規則，先對舊檔案紅過 |
| 2 | 已修 | 版本表只有本人讀得到；CI 改從 `/api/publish/snapshot` 拿這一筆要建置的內容；只有登記的 CI client id 是 reader（轉碼容器的憑證在 Payload 裡是匿名）；媒體只讀得到已上線內容與正在建置的快照引用的。`payload.integration.test.ts` |
| 3 | 已修 | 驗證策略擋跨站的寫入（`Sec-Fetch-Site`／`Origin`）；後台加上 `frame-ancestors 'none'`。E2E 全數通過，證明正常的瀏覽器請求不受影響。**Access cookie 的 SameSite 仍建議你在儀表板設成 Lax** |
| 4 | 已修 | promoted 只記這次 run 實際搬出去的 key，失敗的 run 也記；沒成功上線就在同一次 run 撤回；撤回上限改以已 promote 總數計（至少 4 個），中止會寄信 |
| 5 | 已修 | compare-and-set；資料庫的部分唯一索引保證最多一筆 dispatched；先搶到再 dispatch；run-name 帶嘗試次數；還在跑的不判失敗；run 結束沒回呼時讀線上 manifest；狀態頁只讀。競態用「看門狗讀完之後、寫回之前回呼先到」的測試重現過 |
| 6 | 已修 | 送出時拍快照（文件＋還沒上線的依賴），驗證、建置、定案只用它；已上線依賴的新草稿不會被順手發佈；正文區塊的引用也算 |
| 7 | 程式已修，**真容器未驗** | 補上綁定（設定測試會擋）；`onActivityExpired` 還在轉就不停；成品分段寫入；心跳看門狗；網址綁定嘗試次數；不在回報請求裡同步重派。手機直拍的比例錯誤以真的 ffmpeg 重現並修正。**Docker 映像沒有建過，`sleepAfter` 的修正只能在 staging 用真的容器驗** |
| 8 | 已修 | 拿掉 Editor 自己的「略過第一次」。E2E「已經存過的文章只做一次編輯」在修正前紅、修正後三種裝置都綠 |
| 9 | 已修 | 兩種巢狀清單的形狀都保留；不支援的格式、合併儲存格、儲存格裡的標題改為丟錯 |

### P1

| # | 狀態 | 說明 |
|---|---|---|
| 10 | 已修 | 建置時就套用改名的 301 與撤下時移除指向它的轉址（seam test 的兩個情境；把修正拿掉後 verify-links 照審查預測的那樣擋下）；從沒上線的草稿直接刪 |
| 11 | 已修 | 回呼的內部錯誤回 500；快照讓版本數上限不再影響定案 |
| 12 | 已修 | GPS 閘門依內容判斷、涵蓋 XMP 與 PNG 文字區塊。**附註**：經由 Local API，宣告成 `application/octet-stream` 的帶 GPS 圖片在舊程式碼裡其實已被擋下（Payload 會把偵測到的類型交給 hook）；審查說的 REST multipart 繞過路徑沒能在本機重現。新的閘門不依賴這一點 |
| 13 | 已修 | `downloadable: false` 不 promote GPX 原檔 |
| 14 | 已修 | 存檔前比對伺服器版本；兩台裝置的 E2E 在修正前紅 |
| 15 | 已修 | 回答之前不存檔、不寫備份、編輯區 inert；E2E 在修正前紅 |
| 16 | 部分 | `test:seam` 與遷移對照接進 `admin-ci.yml`。**四個新 workflow 仍然沒有在 GitHub 上跑過**：`repository_dispatch` 只從預設分支觸發，要合併並設好 secrets 之後才會第一次執行 |
| 17 | 已修 | 驗證請求的步驟加 pipefail；請求不合格時回呼仍會告訴後台是哪一筆 |
| 18 | 已修 | 引號以整段為單位配對；測試直接拿 git 模式用的 satteri 當答案（它是原生模組，規則讀不到原始碼）。satteri 在 `"*斜體*"後面` 輸出兩個開引號，這裡照做，以求逐字相同 |

### P2 與測試

已修：rollback 失敗另立 `rollback`、部署後被取消也回滾、dispatch 失敗只通知一次、完整性護欄涵蓋路線影片轉址、
dev bypass 不信 `x-forwarded-host`、回呼與排程用兩把密鑰、路線 SVG 的建置檢查與欄位寫入限制、`/\evil.com`、zip 炸彈、
直拍的比例與縮放、ffmpeg 只讀本機檔、GPX 大檔與自閉合點（20 萬點先前要跑 222 秒）、上傳一天沒完成就收掉、
完成上傳時檢查大小、原檔不再假裝支援 Range、figure 的 href、圖組、表格裡的 `|`、粗體的程式碼、引言與換行後的區塊開頭、
有序清單起始編號、JSX 屬性的 `&`、匯入時擋連結、標題 id、多段引言、thead、匯入的外站連結不再開新分頁、
頁面發佈改為明確拒絕、譯文一律讀 git、備份的路線格式、路線距離 0、flush 等存檔、建立冪等、卸載時存檔、
上一頁回到新文章、存檔期間的備份、標籤欄位、設定抽屜的焦點與 Esc、
GPS 的 E2E 改讀這篇文章的圖、影片 E2E 的標題、表單反向驗證改呼叫真的函式。

**審查的說法不成立**：P1-14 附帶的「撤下會把較新的草稿埋掉」。測試在舊程式碼上就通過——Payload 以草稿狀態更新時，
較新的草稿本來就留在最上面。測試留著當護欄。

**還沒做**（需要你決定，或屬於下一步）：

- **失敗建置的 log 是公開的**（repo 是公開的）：發佈失敗時，那一篇的 slug、檢查訊息會出現在 Actions 的 log 與 artifact。
  要嘛接受，要嘛把 repo 改成私有、或不在 log 裡輸出內容。這是取捨，由你決定
- 已上線的影片重新轉碼、或改了 slug 的路線：公開端仍是舊檔（key 不變而 promote 只搬「公開端沒有的」）
- Dockerfile 的 base image 沒有釘 digest（這裡無法連網確認 digest）
- 簽章網址在 query string 裡，會出現在 Workers 的 observability log
- 回呼的 HMAC 沒有涵蓋路徑與方法（已用兩把密鑰降低風險）
- 後台只設了 `frame-ancestors`，沒有完整的 CSP（會擋到 Payload 自己的管理介面）
- 圖組、媒體選擇器的抽屜還沒有焦點管理；手機上操作列蓋住分頁列
- E2E 的逾時不是量出來的
- 那一次「發佈時 slug 是空的」至今沒有找到機制；探針已改成重新打開抽屜再讀（從 React 的狀態重畫）

### 最後一次完整執行（本機）

| 項目 | 結果 |
|---|---|
| 後台 `verify:deps`／`verify:tokens`／`verify:migrations`／`typecheck` | 全過 |
| 後台單元與整合測試 | 843 通過（1 個是只在 `PARITY=1` 時跑的遷移對照） |
| 後台 E2E（三種裝置，建好的 Worker） | 51 通過 |
| 前台 `pnpm check`、建置＋五項 postbuild 檢查、E2E | 0 錯誤；五項全過；12 通過 |
| `pnpm test:seam` | 全部通過 |
| 遷移對照（`PARITY=1`，29 篇，含標題 id 與連結） | 零差異 |
| `verify-workflows`、`verify-docs` | 全過 |

## 合併之後（2026-10-16，對照設定清單時發現）

| 問題 | 處理 |
|---|---|
| **看門狗永遠找不到 run**：`publish.yml` 的 `run-name` 沒加引號，「 #」之後在 YAML 裡是註解，GitHub 上的標題只有 `publish <requestId>`，而看門狗比對的是 `publish <requestId> #<attempt>`。結果是看門狗對每一筆都查到「找不到 run」：回呼正常（約 6 分鐘內）時沒事；run 跑超過 15 分鐘（job 上限 20 分鐘）就會在它還在跑時被重送而重複部署；回呼遺失時則一路重送三次，用不到「讀線上 manifest 判斷是否已上線」那條路 | 加引號；`checkPublish` 改成要求 run-name 與看門狗的格式逐字相同（以 YAML 實際解析的結果比對，未加引號的版本會紅） |
| GitHub App 照設定清單給 `contents: read`，但 repository_dispatch 要 Contents: write，每次發佈都會 403 | 改成 workflow_dispatch（inputs `request`／`request_id`／`attempt`），App 只需要 Actions: Read and write。`parseDispatch` 另外檢查 run-name 用的兩欄與 `request` 一致 |
| staging 的 `vars` 沒有 `ACCESS_CI_CLIENT_ID`（env 不繼承頂層 vars） | 補上鍵 |
| 設定清單：R2 token 無法限定前綴、轉碼 Worker 不需要 `VIDEO_INTERNAL_SECRET`、私鑰要轉 PKCS#8、staging 沒有發佈流程 | `docs/admin-setup.md` 改寫，附上每一個值的命令 |
