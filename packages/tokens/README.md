# 設計 token

前台（`src/styles/theme.css` 轉接）與後台（`admin/`）共用的唯一來源。
要新增或修改顏色、字級、間距，改這一份，兩邊同時生效。

後台的樣式不得在這個檔案之外寫死色碼或間距（`admin/scripts/verify-tokens.mjs` 會擋）。
