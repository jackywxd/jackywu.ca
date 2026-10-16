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
    { name: 'reason', type: 'text' },
  ],
};
