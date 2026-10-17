# 基礎設施即程式碼（OpenTofu）runbook

後台（admin.jackywu.ca 一套）與 zone 設定改由 [`infra/`](../infra/) 裡的程式碼管理。這份文件是**照著敲就能跑**的命令清單：
每一步寫了在哪裡跑、跑什麼、預期看到什麼、看到別的怎麼辦。

約定：

- 所有命令都在 repo 根目錄（`~/repos/jackywu.ca.next`）的 **macOS 終端機 App** 裡跑（zsh）。
  不要在 Claude 視窗的終端機面板跑會碰到秘密的步驟，也不要把輸出貼進對話。
- token 只放在當下的 shell 變數裡（`read -rs`，不顯示、不進 history），用完 `unset`，並到 dashboard 撤銷。
- 標了 **不可逆** 的步驟，跑之前先確認上一步的檢查點是綠的。

目前進度：M0（探索）已可執行；M1 之後的步驟會隨程式碼一起補上，**還沒寫好的步驟不要自己猜著跑**。

---

## 準備：安裝工具（一次）

```bash
brew install opentofu
```

```bash
tofu version
```

預期第一行是 `OpenTofu v1.13.x`。不是的話：`brew upgrade opentofu`。

```bash
gh auth status
```

預期 `Logged in to github.com account jackywxd`。不是的話：`gh auth login`。

---

## M0：探索既有資源（唯讀）

目的：把 dashboard 上現有的東西（Access、DNS、轉址與 cache rules、R2 lifecycle、Worker 現況、GitHub environments）
讀成一份**非機密**快照，和一份 import 區塊草稿。腳本只發 GET，不會改任何東西。

### 1. 建一把唯讀 token（dashboard）

1. 打開 <https://dash.cloudflare.com/profile/api-tokens> → **Create Token**。
2. 選範本 **Read all resources** → **Use template**。
   用 user token 而不是 account token：Workers Builds 的 API 只接受 user token。
   範本清單裡找不到這一項時，改選 **Create Custom Token**，加入以下全部是 **Read** 的權限：
   Account → Access: Apps and Policies、Access: Organizations, Identity Providers, and Groups、Access: Service Tokens、
   D1、Workers R2 Storage、Workers Scripts、Email Routing Addresses；
   Zone → Zone、DNS、Zone Settings、Config Rules、Cache Rules、Single Redirect、Email Routing Rules。
   漏掉的權限不會讓腳本失敗，只會在最後列出讀不到的項目。
3. **TTL**：結束日期設成明天。其他保持預設 → **Continue to summary** → **Create Token**。
4. 畫面上的 token 只顯示一次，先不要關，下一步貼進終端機。

### 2. 把 token 放進 shell（不顯示、不進 history）

```bash
read -rs "CLOUDFLARE_API_TOKEN?貼上唯讀 token 後按 Enter: " && export CLOUDFLARE_API_TOKEN && echo
```

檢查 token 是有效的（只印狀態，不印 token）：

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify | jq -r '.result.status'
```

預期：`active`。印出 `null` 代表 token 貼錯了，重做第 2 步。

### 3. 執行探索

```bash
node infra/scripts/discover.mjs
```

預期最後幾行：

```
✓ 快照：infra/discovery/snapshot.json（DNS N 筆歸 tofu、M 筆不歸；rulesets K；Access apps 3）
✓ import 草稿：infra/discovery/imports.draft.tf
```

- 若有「有 N 項讀不到」：每一行是一個 API 路徑加 HTTP 狀態碼。`403` 多半是範本少了某個 Read 權限，
  把那幾行原樣貼給我（裡面只有路徑與錯誤代碼，沒有秘密）。
- `Access apps` 應該是 3（admin、admin-staging、staging）。不是 3 就停下來告訴我。

### 4. 檢查快照裡沒有秘密，然後收尾

快照會進公開 repo。腳本只寫白名單欄位，但仍請過目一次：

```bash
git diff --stat
```

```bash
less infra/discovery/snapshot.json
```

應該只看到 id、名稱、主機名、DNS 記錄內容、規則運算式、secret 的**名稱**（例如 `PAYLOAD_SECRET`），不會有任何 secret 的值。

收尾：清掉 shell 裡的 token，並到 <https://dash.cloudflare.com/profile/api-tokens> 把這把 token **Delete**。

```bash
unset CLOUDFLARE_API_TOKEN
```

完成之後告訴我，我會讀快照、整理 import 區塊，接著寫 M1。

---

## M1 之後

尚未完成。每一步會在對應的程式碼合併時補上，格式同上：在哪裡跑、命令、預期輸出、出錯怎麼辦。
規劃見 [後台設定清單](admin-setup.md) 與發佈相關的 [runbook](runbook-publish.md)。
