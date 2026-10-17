import type { CollectionConfig } from 'payload';
import { isOwner, readAnyAuthed } from '../access';

/** 改 slug 或日期時由 hook 自動寫入；建置時與 public/_redirects 合併 */
export const Redirects: CollectionConfig = {
  slug: 'redirects',
  admin: { useAsTitle: 'from', hidden: true },
  access: { read: readAnyAuthed, create: isOwner, update: isOwner, delete: isOwner },
  fields: [
    { name: 'from', type: 'text', required: true, unique: true, index: true, validate: (x: unknown) => (typeof x === 'string' && x.startsWith('/') && !/\s/.test(x) ? true : '必須以 / 開頭且不含空白（空白要寫成 %20）') },
    { name: 'to', type: 'text', required: true, validate: (x: unknown) => (typeof x === 'string' && x.startsWith('/') && !/\s/.test(x) ? true : '必須以 / 開頭且不含空白（空白要寫成 %20）') },
    // 302 給「文章還沒寫、暫時轉到分類頁」那幾條：301 會被瀏覽器與搜尋引擎永久快取，之後改不回來
    { name: 'status', type: 'select', defaultValue: '301', options: ['301', '302'] },
    { name: 'reason', type: 'text' },
  ],
};
