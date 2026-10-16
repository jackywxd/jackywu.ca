/**
 * 最小的 EXIF 讀取：只回答「這個 JPEG 有沒有 GPS 資訊」。
 * 跑步、滑雪的照片常常拍在家附近，GPS 不能跟著上線。
 * 瀏覽器端重新編碼會去掉 EXIF，但伺服器不能只相信瀏覽器——任何繞過前端的上傳（API、匯入）都要再擋一次。
 *
 * 掃 JPEG 的 APP1 區段，解析 TIFF 的 IFD0，找 GPS IFD 指標（tag 0x8825）。
 * 格式不合法時回 'unreadable'，由呼叫端決定要不要拒收。
 */
export type GpsCheck = 'none' | 'gps' | 'unreadable';

export function jpegGps(buf: Uint8Array): GpsCheck {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 'unreadable';
  let p = 2;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return 'unreadable';
    const marker = buf[p + 1]!;
    if (marker === 0xda || marker === 0xd9) return 'none'; // 到影像資料了，沒有更多中繼資料
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const len = (buf[p + 2]! << 8) | buf[p + 3]!;
    if (len < 2 || p + 2 + len > buf.length) return 'unreadable';
    if (marker === 0xe1 && len >= 16 && String.fromCharCode(...buf.subarray(p + 4, p + 10)) === 'Exif\0\0') {
      return tiffHasGps(buf.subarray(p + 10, p + 2 + len));
    }
    p += 2 + len;
  }
  return 'none';
}

function tiffHasGps(t: Uint8Array): GpsCheck {
  if (t.length < 8) return 'unreadable';
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return 'unreadable';
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) return 'unreadable';
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 'unreadable';
  const n = u16(ifd);
  if (ifd + 2 + n * 12 > t.length) return 'unreadable';
  for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === 0x8825) return 'gps';
  return 'none';
}
