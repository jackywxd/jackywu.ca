/**
 * 最小的 EXIF 讀取：只回答「這個 JPEG 有沒有 GPS 資訊」。
 * 跑步、滑雪的照片常常拍在家附近，GPS 不能跟著上線。
 * 瀏覽器端重新編碼會去掉 EXIF，但伺服器不能只相信瀏覽器——任何繞過前端的上傳（API、匯入）都要再擋一次。
 *
 * 位置可能在兩個地方：EXIF 的 GPS IFD（tag 0x8825），以及 XMP 的 exif:GPSLatitude／GPSLongitude。兩個都看，
 * 而且掃完所有區段（第一段 EXIF 沒有 GPS 不代表後面的 XMP 沒有）。
 * 格式不合法時回 'unreadable'，由呼叫端決定要不要拒收。
 */
import { unzlibSync } from 'fflate';

export type GpsCheck = 'none' | 'gps' | 'unreadable';
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

const XMP_GPS = /GPS(Latitude|Longitude)/;
const latin1 = (b: Uint8Array) => { let x = ''; for (let i = 0; i < b.length; i += 8192) x += String.fromCharCode(...b.subarray(i, i + 8192)); return x; };
/** 多個檢查結果合起來：有一個是 gps 就是 gps，其次是 unreadable */
const worst = (a: GpsCheck, b: GpsCheck): GpsCheck => (a === 'gps' || b === 'gps' ? 'gps' : a === 'unreadable' || b === 'unreadable' ? 'unreadable' : 'none');

export function jpegGps(buf: Uint8Array): GpsCheck {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 'unreadable';
  let p = 2, found: GpsCheck = 'none';
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return 'unreadable';
    const marker = buf[p + 1]!;
    if (marker === 0xda || marker === 0xd9) return found; // 到影像資料了，沒有更多中繼資料
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const len = (buf[p + 2]! << 8) | buf[p + 3]!;
    if (len < 2 || p + 2 + len > buf.length) return 'unreadable';
    if (marker === 0xe1) {
      const seg = buf.subarray(p + 4, p + 2 + len);
      if (len >= 16 && ascii(seg, 0, 6) === 'Exif\0\0') found = worst(found, tiffHasGps(seg.subarray(6)));
      // XMP（含延伸 XMP）是一段 XML 文字
      else if (/^http:\/\/ns\.adobe\.com\/(xap\/1\.0|xmp\/extension)\//.test(ascii(seg, 0, 40)) && XMP_GPS.test(latin1(seg))) found = 'gps';
      if (found === 'gps') return 'gps';
    }
    p += 2 + len;
  }
  return found;
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



/**
 * PNG：eXIf 區塊裡是一份 TIFF；iTXt 的 XML:com.adobe.xmp 是 XMP；
 * tEXt／zTXt 的 "Raw profile type exif|app1"（ImageMagick 寫的）是十六進位的 EXIF。壓縮的用 fflate 解開；解不開 → unreadable（拒收）
 */
export function pngGps(buf: Uint8Array): GpsCheck {
  if (buf.length < 8 || ascii(buf, 1, 3) !== 'PNG') return 'unreadable';
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8, found: GpsCheck = 'none';
  while (p + 12 <= buf.length) {
    const len = dv.getUint32(p), type = ascii(buf, p + 4, 4);
    if (p + 12 + len > buf.length) return 'unreadable';
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'eXIf') found = worst(found, tiffHasGps(data));
    if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
      const nul = data.indexOf(0);
      const keyword = nul >= 0 ? ascii(data, 0, nul) : '';
      // 取出文字：tEXt 直接是文字；zTXt 是 zlib 壓縮；iTXt 有壓縮旗標與兩個以 \0 結尾的欄位
      let text: string | null = null;
      try {
        if (type === 'tEXt') text = latin1(data.subarray(nul + 1));
        else if (type === 'zTXt') text = latin1(unzlibSync(data.subarray(nul + 2)));
        else {
          const compressed = data[nul + 1] === 1;
          let q = nul + 3;
          q = data.indexOf(0, q) + 1; q = data.indexOf(0, q) + 1; // 語言標籤、翻譯過的關鍵字
          const body = data.subarray(q);
          text = latin1(compressed ? unzlibSync(body) : body);
        }
      } catch { text = null; }
      if (keyword === 'XML:com.adobe.xmp') {
        if (text === null) found = worst(found, 'unreadable');
        else if (XMP_GPS.test(text)) found = 'gps';
      }
      if (/^Raw profile type (exif|APP1)$/i.test(keyword)) {
        if (text === null) found = worst(found, 'unreadable');
        else {
          // 格式：\n<類型>\n<長度>\n<十六進位…>。類型可能有空白（ImageMagick 寫的是「generic profile」），所以以換行分段
          const hex = text.replace(/^\s*[^\n]*\n\s*\d+\s*\n/, '').replace(/\s+/g, '');
          const raw = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
          const at = latin1(raw.subarray(0, 16)).indexOf('Exif\0\0');
          found = worst(found, tiffHasGps(at >= 0 ? raw.subarray(at + 6) : raw));
        }
      }
    }
    if (found === 'gps') return 'gps';
    if (type === 'IEND') return found;
    p += 12 + len;
  }
  return 'unreadable';
}

/** WebP：RIFF 容器裡的 EXIF 區塊（內容可能帶 "Exif\0\0" 前綴）與 XMP 區塊 */
export function webpGps(buf: Uint8Array): GpsCheck {
  if (buf.length < 12 || ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 4) !== 'WEBP') return 'unreadable';
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 12, found: GpsCheck = 'none';
  while (p + 8 <= buf.length) {
    const type = ascii(buf, p, 4), len = dv.getUint32(p + 4, true);
    if (p + 8 + len > buf.length) return 'unreadable';
    if (type === 'EXIF') {
      let d = buf.subarray(p + 8, p + 8 + len);
      if (ascii(d, 0, 6) === 'Exif\0\0') d = d.subarray(6);
      found = worst(found, tiffHasGps(d));
    }
    if (type === 'XMP ' && XMP_GPS.test(latin1(buf.subarray(p + 8, p + 8 + len)))) found = 'gps';
    if (found === 'gps') return 'gps';
    p += 8 + len + (len & 1);
  }
  return found;
}

/** 依檔案開頭的位元組判斷圖片格式（不信副檔名與宣告的類型） */
export function sniffImage(buf: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && ascii(buf, 1, 3) === 'PNG') return 'image/png';
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * 媒體上傳的 GPS 閘門：依內容判斷是不是圖片，是就檢查位置。宣告的類型由用戶端決定——
 * 把帶 GPS 的 JPEG 宣告成 application/octet-stream，先前就不會被檢查。
 * 宣告成圖片、內容卻不是圖片 → unreadable（拒收）；不是圖片的檔案（影片、GPX）不在這裡檢查。
 */
export function mediaGpsGate(file: { data: Uint8Array; mimetype: string }): GpsCheck {
  const kind = sniffImage(file.data);
  if (kind) return imageGps(file.data, kind);
  return file.mimetype.startsWith('image/') ? 'unreadable' : 'none';
}

/** 依 MIME 類型檢查；不支援的類型回 'unreadable'（呼叫端拒收） */
export function imageGps(buf: Uint8Array, mimetype: string): GpsCheck {
  if (mimetype === 'image/jpeg') return jpegGps(buf);
  if (mimetype === 'image/png') return pngGps(buf);
  if (mimetype === 'image/webp') return webpGps(buf);
  return 'unreadable';
}
