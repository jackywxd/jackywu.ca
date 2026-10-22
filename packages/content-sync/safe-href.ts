/** 連結只允許 http、https、mailto、站內路徑（/ 開頭，不能是 // 或 /\ ——瀏覽器會把 /\evil.com 當成外站）、錨點。
 *  內文連結（lexical.ts）與內嵌 HTML（markup.ts）共用這一條，規則只活在這裡 */
export const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?![\/\\])|#)/i;
