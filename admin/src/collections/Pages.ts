import type { CollectionConfig } from 'payload';
import { checkSlug } from '@content-rules';
import { isOwner, readPublishedOrOwner, readVersionsOwnerOrPinned } from '../access';

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: { singular: '單頁', plural: '單頁' },
  admin: { useAsTitle: 'title' },
  versions: { drafts: { autosave: false }, maxPerDoc: 25 },
  access: { read: readPublishedOrOwner, readVersions: readVersionsOwnerOrPinned('pages'), create: isOwner, update: isOwner, delete: isOwner },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true, validate: (x: unknown) => (typeof x === 'string' && x ? (checkSlug(x) ?? true) : true) },
    { name: 'subtitle', type: 'text' },
    { name: 'excerpt', type: 'textarea', required: true },
    { name: 'updated', type: 'text' },
    { name: 'hero', type: 'upload', relationTo: 'media' },
    { name: 'heroAlt', type: 'text' },
    { name: 'content', type: 'richText' },
  ],
};
