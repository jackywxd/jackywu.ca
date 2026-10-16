import type { CollectionConfig } from 'payload';
import { checkDate, checkExcerpt, checkSlug, checkTitle, checkVerse, REALMS } from '@content-rules';
import { isOwner, readPublishedOrOwner } from '../access';
import { recordRedirects, validateOnPublish } from './hooks/tale-hooks';

/** 欄位 validate 的包裝：空值交給 required，這裡只管格式 */
const v = (check: (s: string) => string | null) => (val: unknown) =>
  typeof val === 'string' && val !== '' ? (check(val) ?? true) : true;

export const Tales: CollectionConfig = {
  slug: 'tales',
  labels: { singular: '文章', plural: '文章' },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'realm', 'date', '_status'] },
  versions: { drafts: { autosave: false }, maxPerDoc: 25 },
  access: { read: readPublishedOrOwner, create: isOwner, update: isOwner, delete: isOwner },
  hooks: { beforeChange: [validateOnPublish], afterChange: [recordRedirects] },
  fields: [
    { name: 'title', type: 'text', required: true, validate: v(checkTitle) },
    // 全站唯一。CJK 標題不自動音譯，必須手動給
    { name: 'slug', type: 'text', required: true, unique: true, index: true, validate: v(checkSlug) },
    // YYYY-MM-DD 字串，不帶時區：溫哥華深夜發文不會被 UTC 推到隔天
    { name: 'date', type: 'text', required: true, validate: v(checkDate) },
    { name: 'updated', type: 'text', validate: v(checkDate) },
    { name: 'realm', type: 'select', required: true, options: [...REALMS] },
    { name: 'lang', type: 'select', defaultValue: 'zh-Hant', options: ['zh-Hant', 'en'] },
    { name: 'tags', type: 'text', hasMany: true },
    { name: 'featured', type: 'checkbox', defaultValue: false },
    { name: 'excerpt', type: 'textarea', required: true, validate: v(checkExcerpt) },
    { name: 'verse', type: 'text', validate: v(checkVerse) },
    { name: 'shareable', type: 'checkbox', defaultValue: true },
    { name: 'xhsTags', type: 'text', hasMany: true },
    { name: 'hero', type: 'upload', relationTo: 'media' },
    { name: 'heroAlt', type: 'text' },
    { name: 'video', type: 'relationship', relationTo: 'reels' },
    { name: 'route', type: 'relationship', relationTo: 'routes' },
    {
      name: 'legacy',
      type: 'group',
      fields: [
        { name: 'url', type: 'text', validate: (x: unknown) => (!x || String(x).startsWith('/blog/') ? true : '必須以 /blog/ 開頭') },
        { name: 'brokenImages', type: 'text', hasMany: true },
      ],
    },
    { name: 'content', type: 'richText' },
  ],
};
