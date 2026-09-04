/**
 * 最小 TTF/OTF cmap 讀取器：回傳字型實際涵蓋的碼位集合。
 *
 * 存在的理由：satori 缺字是「靜默」的 —— 沒有系統字型、沒有 fallback chain，
 * 缺字直接畫成空白且不拋錯。建置成功不代表海報上的字有畫出來，
 * 所以必須真的翻開字型檔數一遍。
 */

const u16 = (b, o) => b.readUInt16BE(o);
const u32 = (b, o) => b.readUInt32BE(o);

export function codepoints(buf) {
  const numTables = u16(buf, 4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString('ascii', rec, rec + 4) === 'cmap') { cmapOff = u32(buf, rec + 8); break; }
  }
  if (!cmapOff) throw new Error('字型沒有 cmap 表');

  // 挑最好的子表：優先 (3,10) format 12，其次 (3,1) format 4
  const n = u16(buf, cmapOff + 2);
  let best = 0, bestScore = -1;
  for (let i = 0; i < n; i++) {
    const rec = cmapOff + 4 + i * 8;
    const plat = u16(buf, rec), enc = u16(buf, rec + 2), off = cmapOff + u32(buf, rec + 4);
    const score = plat === 3 && enc === 10 ? 3 : plat === 3 && enc === 1 ? 2 : plat === 0 ? 1 : 0;
    if (score > bestScore) { bestScore = score; best = off; }
  }

  const out = new Set();
  const format = u16(buf, best);
  if (format === 4) {
    const segX2 = u16(buf, best + 6);
    const endO = best + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = u16(buf, endO + s * 2), start = u16(buf, startO + s * 2);
      const delta = buf.readInt16BE(deltaO + s * 2), rangeOff = u16(buf, rangeO + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let g;
        if (rangeOff === 0) g = (c + delta) & 0xffff;
        else {
          const gi = rangeO + s * 2 + rangeOff + (c - start) * 2;
          if (gi + 1 >= buf.length) continue;
          g = u16(buf, gi);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) out.add(c);
      }
    }
  } else if (format === 12) {
    const groups = u32(buf, best + 12);
    for (let i = 0; i < groups; i++) {
      const g = best + 16 + i * 12;
      const start = u32(buf, g), end = u32(buf, g + 4);
      for (let c = start; c <= end; c++) out.add(c);
    }
  } else {
    throw new Error(`不支援的 cmap format ${format}`);
  }
  return out;
}

/** 回傳 text 裡「字型沒有」的字元 */
export function missingFrom(buf, text) {
  const have = codepoints(buf);
  const miss = new Set();
  for (const ch of text) if (!have.has(ch.codePointAt(0))) miss.add(ch);
  return [...miss];
}
