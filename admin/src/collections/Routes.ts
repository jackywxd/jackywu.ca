import type { CollectionConfig } from 'payload';
import { TRADES, checkDate, checkSlug } from '@content-rules';
import { isOwner, readPublishedOrOwner, readVersionsOwnerOnly } from '../access';

export const Routes: CollectionConfig = {
  slug: 'routes',
  labels: { singular: '路線', plural: '路線' },
  admin: { useAsTitle: 'name' },
  versions: { drafts: { autosave: false }, maxPerDoc: 10 },
  access: { read: readPublishedOrOwner, readVersions: readVersionsOwnerOnly, create: isOwner, update: isOwner, delete: isOwner },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true, validate: (x: unknown) => (typeof x === 'string' && x ? (checkSlug(x) ?? true) : true) },
    { name: 'nameEn', type: 'text' },
    { name: 'realm', type: 'select', required: true, options: [...TRADES] },
    { name: 'date', type: 'text', required: true, validate: (x: unknown) => (typeof x === 'string' && x ? (checkDate(x) ?? true) : true) },
    { name: 'region', type: 'text', required: true },
    // GPX 原檔放在私有 bucket 的 gpx/<slug>.gpx（由 /api/routes/from-gpx 寫入）；發佈時才複製到公開位置
    { name: 'hasGpx', type: 'checkbox', defaultValue: false, admin: { readOnly: true } },
    // 前台的 schema 要求正數：0 在這裡就擋，不等到建置
    { name: 'distanceKm', type: 'number', validate: (x: unknown) => (x == null || (typeof x === 'number' && x > 0) ? true : '距離必須大於 0') },
    { name: 'gainM', type: 'number', min: 0 },
    { name: 'elapsed', type: 'text', validate: (x: unknown) => (!x || /^P/.test(String(x)) ? true : 'ISO 8601 duration，例如 PT21H47M') },
    { name: 'result', type: 'text' },
    { name: 'badge', type: 'text' },
    { name: 'note', type: 'text', maxLength: 200 },
    { name: 'cover', type: 'upload', relationTo: 'media' },
    { name: 'coverAlt', type: 'text' },
    { name: 'downloadable', type: 'checkbox', defaultValue: true },
    // 由 GPX 算出來的三張 SVG，唯讀
    { name: 'svgTrack', type: 'textarea', admin: { readOnly: true } },
    { name: 'svgThumb', type: 'textarea', admin: { readOnly: true } },
    { name: 'svgProfile', type: 'textarea', admin: { readOnly: true } },
  ],
};
