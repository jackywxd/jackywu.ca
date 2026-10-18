/**
 * 只看檔頭判斷是不是 FIT，不載入 SDK：上傳表單用它決定要不要動態載入 FIT 解析（GPX 不必下載 SDK）。
 * 檔頭第 8–11 個 byte 是 ".FIT"：用內容判斷，不看副檔名。
 */
export function isFit(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}
