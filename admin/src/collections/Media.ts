import type { CollectionConfig } from 'payload';
import { APIError } from 'payload';
import { isOwner, readAnyAuthed } from '../access';
import { jpegGps } from '../lib/exif';

/**
 * 媒體。檔案存在「私有」bucket（hongchen-admin-private）：沒有自訂網域、r2.dev 關閉。
 * 發佈時才由部署流程複製到公開位置（影片、GPX）或編進 dist（圖片）。
 */
export const Media: CollectionConfig = {
  slug: 'media',
  admin: { useAsTitle: 'alt' },
  upload: {
    // 沒有 sharp：Workers 上跑不了。縮圖、裁切都留到建置期
    crop: false,
    focalPoint: false,
    // 圖片只收 JPEG：瀏覽器端一律縮小並重新編碼成 JPEG；影片與 GPX 走各自的上傳流程（M6、M7）
    mimeTypes: ['image/jpeg', 'video/mp4', 'video/quicktime', 'application/gpx+xml', 'application/octet-stream'],
  },
  access: { read: readAnyAuthed, create: isOwner, update: isOwner, delete: isOwner },
  hooks: {
    beforeValidate: [
      // 伺服器不能只相信瀏覽器：任何繞過前端的上傳，只要 JPEG 帶 GPS 一律拒收
      ({ req, data }) => {
        const f = req.file;
        if (f && f.mimetype === 'image/jpeg') {
          const r = jpegGps(f.data);
          if (r === 'gps') throw new APIError('這張圖片含有 GPS 位置資訊，不能上傳。請從瀏覽器的上傳介面上傳（會自動去掉），或先移除位置資訊。', 400, undefined, true);
          if (r === 'unreadable') throw new APIError('無法讀取這個 JPEG 檔案', 400, undefined, true);
        }
        return data;
      },
    ],
  },
  fields: [
    { name: 'alt', type: 'text', required: true },
    { name: 'sha256', type: 'text', unique: true, index: true, admin: { readOnly: true } },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    {
      name: 'kind',
      type: 'select',
      options: ['img', 'video', 'gpx'],
      required: true,
      defaultValue: 'img',
    },
    // 預設 attachment：UploadFeature 不會帶這個欄位
    { name: 'usage', type: 'select', options: ['attachment', 'hero', 'gallery'], defaultValue: 'attachment' },
  ],
};
