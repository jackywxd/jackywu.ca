/**
 * 遷移時的圖片前處理（admin/scripts/migrate-push.ts）：帶 GPS 的在本機去掉位置資訊再上傳（後台會拒收帶 GPS 的圖），
 * 其他原樣上傳。只在 node 跑（用 sharp），不進 Worker。
 */
import { mediaGpsGate, sniffImage } from '../exif';

export async function prepareImage(raw: Uint8Array, name: string): Promise<{ data: Uint8Array; type: string; stripped: boolean }> {
  const type = sniffImage(raw);
  if (!type) throw new Error(`不是支援的圖片格式：${name}`);
  const gate = mediaGpsGate({ data: raw, mimetype: type });
  if (gate === 'unreadable') throw new Error(`讀不出圖片：${name}`);
  if (gate !== 'gps') return { data: raw, type, stripped: false };
  const sharp = (await import('sharp')).default;
  const img = sharp(raw).rotate(); // 把方向寫進像素，再丟掉全部 metadata（含 GPS）
  const out = type === 'image/png' ? await img.png().toBuffer() : type === 'image/webp' ? await img.webp({ quality: 92 }).toBuffer() : await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  const data = new Uint8Array(out);
  const again = mediaGpsGate({ data, mimetype: type });
  if (again !== 'none') throw new Error(`去掉 GPS 之後仍未通過檢查（${again}）：${name}`);
  return { data, type, stripped: true };
}
