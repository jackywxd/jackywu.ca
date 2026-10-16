/**
 * 後台樣式只能用共用 token（packages/tokens）：不准寫死色碼，也不准寫死大於 3px 的長度。
 * 寫死的值會讓前台改了 token、後台卻不跟著變——兩個站慢慢長得不一樣。
 */
const HEX = /(^|[^&\w#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const FUNC = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/;
const PX = /(?<![\w.-])(?:[4-9]|[1-9]\d+)(?:\.\d+)?px\b/;

/** 回傳違規清單 [{line, rule, text}]。註解與字串裡的 URL 不算。 */
export function scan(source, file = '') {
  const out = [];
  const lines = source.split('\n');
  let inBlockComment = false;
  lines.forEach((raw, i) => {
    let line = raw;
    if (inBlockComment) { const e = line.indexOf('*/'); if (e < 0) return; line = line.slice(e + 2); inBlockComment = false; }
    // 去掉同行的區塊註解與行註解
    line = line.replace(/\/\*.*?\*\//g, '');
    const s = line.indexOf('/*'); if (s >= 0) { inBlockComment = true; line = line.slice(0, s); }
    line = line.replace(/(^|\s)\/\/.*$/, '$1').replace(/https?:\/\/\S+/g, '');
    if (HEX.test(line)) out.push({ line: i + 1, rule: '寫死的色碼', text: raw.trim(), file });
    if (FUNC.test(line)) out.push({ line: i + 1, rule: '寫死的色彩函式', text: raw.trim(), file });
    if (PX.test(line)) out.push({ line: i + 1, rule: '寫死的 px 長度（>3px）', text: raw.trim(), file });
  });
  return out;
}
