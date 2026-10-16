/**
 * 瀏覽器端的圖片處理：縮小、重新編碼（順帶去掉 EXIF，GPS 不會跟著上線）、算 sha256。
 * 純數學的部分（fitWithin、extOf）可在 Node 測；Canvas 的部分由瀏覽器（Playwright）測。
 */
export const MAX_EDGE = 2560;
export const JPEG_QUALITY = 0.85;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function fitWithin(w: number, h: number, max = MAX_EDGE): { width: number; height: number; scaled: boolean } {
  if (!(w > 0 && h > 0)) throw new Error(`圖片尺寸不合理：${w}×${h}`);
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h, scaled: false };
  const k = max / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), scaled: true };
}

export const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif';

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface PreparedImage { blob: Blob; width: number; height: number; sha256: string; filename: string }

/** 讀圖 → 依 EXIF 轉正 → 縮小 → 重新編碼成 JPEG（EXIF 因此全部消失）。PNG 有透明度時保留 PNG。 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`檔案太大（${(file.size / 1048576).toFixed(1)} MB，上限 50 MB）`);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('這個瀏覽器無法解碼這張圖（HEIC 請先在相簿匯出成 JPEG）');
  }
  const { width, height } = fitWithin(bmp.width, bmp.height);
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('無法建立畫布');
  g.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  const sha256 = await sha256Hex(await blob.arrayBuffer());
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'image';
  return { blob, width, height, sha256, filename: `${base}.jpg` };
}

export interface MediaItem { id: number | string; alt: string; filename: string; width?: number | null; height?: number | null; sha256?: string | null; url?: string | null }

export const mediaFileUrl = (m: Pick<MediaItem, 'filename'>) => `/api/media/file/${encodeURIComponent(m.filename)}`;

/** 上傳；同一張圖（sha256 相同）已經存在就直接回既有的那筆，不重複存 */
export async function uploadImage(file: File, alt: string, fetchFn: typeof fetch = fetch): Promise<MediaItem> {
  const p = await prepareImage(file);
  const dup = await fetchFn(`/api/media?where[sha256][equals]=${p.sha256}&limit=1&depth=0`);
  if (dup.ok) {
    const j = (await dup.json()) as { docs: MediaItem[] };
    if (j.docs[0]) return j.docs[0];
  }
  const fd = new FormData();
  fd.set('file', new File([p.blob], p.filename, { type: p.blob.type }));
  fd.set('_payload', JSON.stringify({ alt: alt || p.filename.replace(/\.[^.]+$/, ''), sha256: p.sha256, width: p.width, height: p.height, kind: 'img' }));
  const r = await fetchFn('/api/media', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`上傳失敗（${r.status}）：${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { doc: MediaItem }).doc;
}
