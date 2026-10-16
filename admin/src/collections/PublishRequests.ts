import type { CollectionConfig } from 'payload';
import { isOwner, readAnyAuthed } from '../access';

/** 發佈佇列的持久化層。狀態轉移的規則全在 src/lib/publish-queue.ts */
export const PublishRequests: CollectionConfig = {
  slug: 'publish-requests',
  admin: { useAsTitle: 'requestId', hidden: true },
  access: { read: readAnyAuthed, create: isOwner, update: isOwner, delete: () => false },
  fields: [
    { name: 'requestId', type: 'text', required: true, unique: true, index: true },
    { name: 'kind', type: 'select', required: true, options: ['publish', 'unpublish', 'delete'] },
    { name: 'collectionSlug', type: 'text', required: true },
    { name: 'docId', type: 'text', required: true, index: true },
    { name: 'versionId', type: 'text', required: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'queued', options: ['queued', 'dispatched', 'deployed', 'failed'], index: true },
    { name: 'attempts', type: 'number', defaultValue: 0 },
    { name: 'createdAtMs', type: 'number', required: true },
    { name: 'dispatchedAtMs', type: 'number' },
    { name: 'finishedAtMs', type: 'number' },
    { name: 'failure', type: 'json' },
    // 先被判失敗、之後才確認已上線（遲到的回呼，或線上 manifest 證明）
    { name: 'late', type: 'checkbox', defaultValue: false },
    // 送出那一刻的內容（文件＋還沒上線的依賴）。建置與定案都只用它，不再回頭讀版本表（版本可能已被清掉，也可能已被改過）
    { name: 'snapshot', type: 'json' },
  ],
};
