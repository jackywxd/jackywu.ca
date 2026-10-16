import type { CollectionConfig } from 'payload';
import { isOwner, readAnyAuthed } from '../access';

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
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/quicktime', 'application/gpx+xml'],
  },
  access: { read: readAnyAuthed, create: isOwner, update: isOwner, delete: isOwner },
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
