# 翻譯

這份文件的存在理由：**翻譯是在對話裡做的，不是腳本做的。**腳本會把提示詞和譯法
固化在檔案裡，對話每次從零開始——不寫下來，三個月後的翻譯會跟今天的對不上。

所以這裡是那份「固化的提示詞」。每翻一篇，把**當場新造的譯法回填進來**；詞彙表要
從實際決定長出來，不是一開始憑空想的。

相關：[內容模型](content.md) · [寫作](authoring.md)

---

## 一、哪些要翻，哪些不翻

實際分佈（29 篇）：

| 行當 | 語言 | 篇數 | 打算 |
|---|---|---|---|
| forge 爐火 | en | 18 | **不翻**。讀者是搜 `dnsmasq` 進來的，中譯版不會有人看 |
| run 追雲 | en | 8 | 中譯 |
| run 追雲 | zh-Hant | 2 | 英譯 |
| still 靜 | en | 1 | 紀念文，只有作者能決定 |

**「沒有譯文」是正常狀態，不是待辦事項。**schema 允許單語，不要為了湊齊而硬翻。

---

## 二、絕對不准動的東西

翻譯只碰散文。以下逐字保留，一個字元都不改：

- MDX 元件與 `import`：`<Figure>`、`<Gallery>`、`<Video>`、`<MissingImage>`
- 元件的 props，**包括 `alt` 以外的所有值**（`src`、`entry`、`ratio`…）
- 程式碼區塊的內容（連註解也不翻——那是給讀者複製貼上的）
- 圖片路徑：`./remote-14059496.jpg` 這種相對路徑兩個語言共用，**改了就壞**
- `legacy.url`：那是舊網址，是轉址的來源，不是文字
- 指令、檔名、設定鍵名：`dnsmasq`、`wrangler.jsonc`、`ANTHROPIC_API_KEY`

**可以翻的**：正文散文、`title`、`excerpt`、`verse`、圖片的 `alt`／`figcaption`、
`tags`（若該標籤有慣用英文）。

---

## 三、詞彙表

### 品牌與站內名詞

| 中文 | English | 說明 |
|---|---|---|
| 紅塵客棧 | Red Dust Inn | 已在 `site.nameLatin` |
| 追雲逐雪 | **保留中文** | 這是名號不是詞。英文頁的印章與落款照樣是這四個字 |
| 追雲（行當） | Trail | URL 已是 `/run/` |
| 逐雪 | Snow | `/snow/` |
| 鐵馬 | Road | `/road/` |
| 探幽 | Wild | `/wild/` |
| 爐火 | Forge | `/forge/` |
| 靜 | Still | 不出現在導覽 |
| 輿圖 | Routes | |
| 江湖冊 | Tags | |
| 掌櫃 | Keeper | |
| 影 | Reel | |
| 尋 | Search | |
| 門前 | Home | 首頁的返回連結 |
| 穿越時光 | Time Travel | 首頁按鈕 |
| 行跡 | route / track | 條目種類 |

### 地名

| 中文 | English |
|---|---|
| 卑詩 | BC（正文首次出現用 British Columbia） |
| 亞伯達 | Alberta |
| 威士拿 | Whistler |
| 溫哥華 | Vancouver |
| 加里波第公園 | Garibaldi Provincial Park |
| 黑爾姆冰川 | Helm Glacier |
| 城堡塔 | Castle Tower |
| 喬弗雷峰 | Mt Joffre |

**英文地名不要中譯回去**：`Grande Cache`、`Duffey Lake`、`Aussie Couloir`、
`Panorama Ridge`、`Metal Dome` 保持原樣。

### 賽事

賽事一律用**官方英文名**，不自創翻譯：

- BMO Vancouver Marathon
- Ultra Trail Whistler by UTMB（縮寫 UTW）
- Canadian Death Race（縮寫 CDR）
- Sinister 7 · San Diego 100 · Quebec Mega Trail · Tor des Géants

中譯時保留英文原名，需要時在後面補一句中文說明，不要音譯。

### 跑步與戶外

| 中文 | English |
|---|---|
| 越野跑 | trail running |
| 爬升 / 累計爬升 | elevation gain |
| 距離 | distance |
| 移動時間 | moving time |
| 實際用時 | elapsed time |
| 配速 | pace |
| 心率 / 靜息心率 | heart rate / resting heart rate |
| 補給站 | aid station |
| 關門時間 | cutoff |
| 完賽 | finished |
| 退賽 | DNF |
| 帶杖 / 徒手 | with poles / without poles |
| 能量成本 | energy cost |
| 滑雪登山 | ski touring |
| 野雪 | backcountry skiing |
| 雪線 | snowline |
| 滑降線 | ski line |
| BQ | Boston Qualifier（首次出現寫全稱） |

---

## 四、語氣

作者的中文是**第一人稱、口語、短句、不抒情過頭**。看
`src/content/tales/2026/grouse-grind-pole-experiment/index.mdx` 就知道——他會寫
「十趟，單數趟徒手、雙數趟帶杖」，不會寫「筆者進行了十次對照實驗」。

英譯要對得上這個人，不是對得上一篇旅遊稿：

- 第一人稱，主動語態
- 短句。中文一句就是英文一句，不要為了「通順」合併成長句
- **不要加原文沒有的形容詞**。「風很大」就是 "it was windy"，不是
  "a relentless wind hammered the ridge"
- 數字、時間、地名照抄，不四捨五入

中譯同理：英文原文是技術筆記就譯成技術筆記，不要文言化。

---

## 五、每翻一篇要做的四件事

1. 讀正本，也讀一篇作者自己寫的同語言文章，抓語氣
2. 讀這份詞彙表
3. 寫 `index.<locale>.mdx`（結構見 [content.md](content.md)）
4. **回報**：哪些詞是這次新造的、哪幾句沒把握。新造的詞當場回填進上面的表

第 4 步是這套做法能不能撐過三個月的關鍵。跳過它，詞彙表就死了。
