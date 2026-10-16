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

export function tiffHasGps(t: Uint8Array): GpsCheck {
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

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

/** PNG：eXIf 區塊裡就是一份 TIFF。沒有 eXIf 區塊就沒有 EXIF 位置 */
export function pngGps(buf: Uint8Array): GpsCheck {
  if (buf.length < 8 || ascii(buf, 1, 3) !== 'PNG') return 'unreadable';
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  while (p + 12 <= buf.length) {
    const len = dv.getUint32(p), type = ascii(buf, p + 4, 4);
    if (p + 12 + len > buf.length) return 'unreadable';
    if (type === 'eXIf') return tiffHasGps(buf.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') return 'none';
    p += 12 + len;
  }
  return 'unreadable';
}

/** WebP：RIFF 容器裡的 EXIF 區塊（內容可能帶 "Exif\0\0" 前綴） */
export function webpGps(buf: Uint8Array): GpsCheck {
  if (buf.length < 12 || ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 4) !== 'WEBP') return 'unreadable';
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 12;
  while (p + 8 <= buf.length) {
    const type = ascii(buf, p, 4), len = dv.getUint32(p + 4, true);
    if (p + 8 + len > buf.length) return 'unreadable';
    if (type === 'EXIF') {
      let d = buf.subarray(p + 8, p + 8 + len);
      if (ascii(d, 0, 6) === 'Exif\0\0') d = d.subarray(6);
      return tiffHasGps(d);
    }
    p += 8 + len + (len & 1);
  }
  return 'none';
}

/** 依 MIME 類型檢查；不支援的類型回 'unreadable'（呼叫端拒收） */
export function imageGps(buf: Uint8Array, mimetype: string): GpsCheck {
  if (mimetype === 'image/jpeg') return jpegGps(buf);
  if (mimetype === 'image/png') return pngGps(buf);
  if (mimetype === 'image/webp') return webpGps(buf);
  return 'unreadable';
}
