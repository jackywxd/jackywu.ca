import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { jpegGps } from '../src/lib/exif';

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
