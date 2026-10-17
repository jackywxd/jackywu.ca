import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { imageGps, jpegGps, mediaGpsGate, pngGps, sniffImage, webpGps } from '../src/lib/exif';

const base = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#789' } });
const gps = { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 17/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '123/1 7/1 0/1' } };

describe('jpegGps', () => {
  it('有 GPS 的 JPEG → gps', async () => {
    expect(jpegGps(await base().withExif({ IFD0: { Make: 'Cam' }, ...gps }).jpeg().toBuffer())).toBe('gps');
  });
  it('有 EXIF 但沒有 GPS → none（只有相機型號不算洩漏位置）', async () => {
    expect(jpegGps(await base().withExif({ IFD0: { Make: 'Cam', Model: 'X1' } }).jpeg().toBuffer())).toBe('none');
  });
  it('完全沒有 EXIF → none', async () => expect(jpegGps(await base().jpeg().toBuffer())).toBe('none'));
  it('瀏覽器重新編碼的產物（sharp 預設會丟掉中繼資料）→ none', async () => {
    const withGps = await base().withExif(gps).jpeg().toBuffer();
    const re = await sharp(withGps).jpeg().toBuffer(); // 預設不保留 EXIF
    expect(jpegGps(re)).toBe('none');
  });
  it('big-endian 的 EXIF 也看得懂', () => {
    // 手工組一個最小 JPEG：SOI + APP1(Exif, MM, IFD0 含 tag 0x8825) + EOI
    const tiff = Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const body = [...Buffer.from('Exif\0\0'), ...tiff];
    const len = body.length + 2;
    expect(jpegGps(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...body, 0xff, 0xd9]))).toBe('gps');
  });
  it.each([[new Uint8Array([]), 'unreadable'], [new Uint8Array([1, 2, 3, 4]), 'unreadable'], [new Uint8Array([0xff, 0xd8]), 'unreadable']])('不合法或空的輸入 %j → %s', (b, r) => expect(jpegGps(b)).toBe(r));
  it('被截斷的 EXIF 區段 → unreadable（不丟例外）', async () => {
    const full = await base().withExif(gps).jpeg().toBuffer();
    expect(jpegGps(full.subarray(0, 40))).toBe('unreadable');
  });
});

describe('PNG 與 WebP', () => {
  it('帶 GPS 的 WebP → gps；沒有 → none', async () => {
    expect(webpGps(await base().withExif(gps).webp().toBuffer())).toBe('gps');
    expect(webpGps(await base().webp().toBuffer())).toBe('none');
  });
  it('帶 GPS 的 PNG → gps；沒有 → none', async () => {
    expect(pngGps(await base().withExif(gps).png().toBuffer())).toBe('gps');
    expect(pngGps(await base().png().toBuffer())).toBe('none');
  });
  it('imageGps 依類型分派；不支援的類型（avif、gif…）→ unreadable，呼叫端拒收', async () => {
    expect(imageGps(await base().jpeg().toBuffer(), 'image/jpeg')).toBe('none');
    expect(imageGps(await base().png().toBuffer(), 'image/png')).toBe('none');
    expect(imageGps(await base().webp().toBuffer(), 'image/webp')).toBe('none');
    expect(imageGps(await base().png().toBuffer(), 'image/gif')).toBe('unreadable');
  });
  it('檔案類型與內容不符 → unreadable', async () => {
    expect(pngGps(await base().jpeg().toBuffer())).toBe('unreadable');
    expect(webpGps(await base().png().toBuffer())).toBe('unreadable');
  });
});

describe('XMP 裡的位置（另一個存放 GPS 的地方；匯入路徑不重新編碼）', () => {
  const xmp = (gps: boolean) => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Cam"${gps ? ' exif:GPSLatitude="49,17.0N" exif:GPSLongitude="123,7.0W"' : ''}/>` +
    `</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  it.each(['jpeg', 'png', 'webp'] as const)('%s：XMP 帶 GPS → gps；XMP 沒有 GPS → none', async (f) => {
    expect(imageGps(await base().withXmp(xmp(true))[f]().toBuffer(), `image/${f}`)).toBe('gps');
    expect(imageGps(await base().withXmp(xmp(false))[f]().toBuffer(), `image/${f}`)).toBe('none');
  });
  it('JPEG 第一段 EXIF 沒有 GPS、後面的 XMP 有 → 還是 gps（不在第一段就停）', async () => {
    expect(jpegGps(await base().withExif({ IFD0: { Make: 'Cam' } }).withXmp(xmp(true)).jpeg().toBuffer())).toBe('gps');
  });
});

describe('sniffImage：依檔案內容判斷，不信宣告的類型', () => {
  it('JPEG、PNG、WebP 認得出來', async () => {
    expect(sniffImage(await base().jpeg().toBuffer())).toBe('image/jpeg');
    expect(sniffImage(await base().png().toBuffer())).toBe('image/png');
    expect(sniffImage(await base().webp().toBuffer())).toBe('image/webp');
  });
  it('不是圖片 → null', () => expect(sniffImage(Buffer.from('<gpx></gpx>'))).toBeNull());
});

describe('mediaGpsGate：上傳的檔案一律依內容判斷（宣告的類型由用戶端決定，不能信）', () => {
  it.each(['application/octet-stream', 'video/mp4', 'application/gpx+xml'])('帶 GPS 的 JPEG 宣告成 %s → 拒收', async (mimetype) => {
    expect(mediaGpsGate({ data: await base().withExif(gps).jpeg().toBuffer(), mimetype })).toBe('gps');
  });
  it('宣告是圖片、內容卻不是 → 拒收（unreadable）', () => expect(mediaGpsGate({ data: Buffer.from('not an image'), mimetype: 'image/jpeg' })).toBe('unreadable'));
  it('不是圖片的檔案（影片、GPX）→ 不在這裡檢查', () => expect(mediaGpsGate({ data: Buffer.from('<gpx/>'), mimetype: 'application/gpx+xml' })).toBe('none'));
  it('乾淨的圖片 → 放行', async () => expect(mediaGpsGate({ data: await base().jpeg().toBuffer(), mimetype: 'application/octet-stream' })).toBe('none'));
});

describe('PNG 的 "Raw profile type exif"（ImageMagick 寫的十六進位 EXIF）', () => {
  /** 在 IEND 前面插一個 tEXt 區塊（pngGps 不驗 CRC，填 0 即可） */
  const withText = (png: Buffer, keyword: string, text: string) => {
    const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0); chunk.write('tEXt', 4, 'latin1'); data.copy(chunk, 8);
    const iend = png.lastIndexOf(Buffer.from('IEND', 'latin1')) - 4;
    return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
  };
  const tiff = (gps: boolean) => Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, ...(gps ? [0x88, 0x25] : [0x01, 0x0f]), 0x00, 0x04, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  const profile = (gps: boolean) => { const raw = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff(gps)]); return `\nexif\n${raw.length}\n${raw.toString('hex')}\n`; };
  it('帶 GPS → gps；沒有 → none', async () => {
    const png = await base().png().toBuffer();
    expect(pngGps(withText(png, 'Raw profile type exif', profile(true)))).toBe('gps');
    expect(pngGps(withText(png, 'Raw profile type exif', profile(false)))).toBe('none');
  });
  // git 裡的舊圖（ImageMagick 轉過）：類型行是兩個字「generic profile」，數字前有縮排。
  // 先前的解析把標頭當成十六進位，得到 unreadable，後台就拒收了這張根本沒有 GPS 的圖
  it('類型行有空白（"generic profile"）也讀得出來', async () => {
    const png = await base().png().toBuffer();
    const raw = tiff(false), withGps = tiff(true);
    const generic = (b: Buffer) => `\ngeneric profile\n      ${b.length}\n${b.toString('hex')}\n`;
    expect(pngGps(withText(png, 'Raw profile type APP1', generic(raw)))).toBe('none');
    expect(pngGps(withText(png, 'Raw profile type APP1', generic(withGps)))).toBe('gps');
  });
});

// 防的失敗：遷移時帶 GPS 的舊圖沒被處理就上傳（後台拒收），或處理後仍帶位置資訊
describe('prepareImage（遷移的前處理）', () => {
  it('帶 GPS 的 JPEG → 去掉之後通過閘門；沒有 GPS 的原樣不動', async () => {
    const { prepareImage } = await import('../src/lib/migration/prepare-image');
    const withGps = new Uint8Array(await base().withExif({ IFD0: { Make: 'Cam' }, ...gps }).jpeg().toBuffer());
    const a = await prepareImage(withGps, 'gps.jpg');
    expect(a.stripped).toBe(true);
    expect(mediaGpsGate({ data: a.data, mimetype: 'image/jpeg' })).toBe('none');
    const clean = new Uint8Array(await base().png().toBuffer());
    const b = await prepareImage(clean, 'clean.png');
    expect(b).toMatchObject({ stripped: false, type: 'image/png' });
    expect(b.data).toBe(clean);
  });
  it('不是圖片 → 丟錯並指出檔名', async () => {
    const { prepareImage } = await import('../src/lib/migration/prepare-image');
    await expect(prepareImage(new Uint8Array([1, 2, 3]), 'x.jpg')).rejects.toThrow(/x\.jpg/);
  });
});
