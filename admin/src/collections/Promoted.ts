import type { CollectionConfig } from 'payload';
import { isOwner, readAnyAuthed } from '../access';

/** 由部署流程複製到公開位置的 key。撤回時「只」刪這裡記錄過的，逐 key。 */
export const Promoted: CollectionConfig = {
  slug: 'promoted',
  admin: { useAsTitle: 'key', hidden: true },
  access: { read: readAnyAuthed, create: isOwner, update: isOwner, delete: isOwner },
  fields: [
    { name: 'key', type: 'text', required: true, unique: true, index: true },
    { name: 'requestId', type: 'text' },
  ],
};
