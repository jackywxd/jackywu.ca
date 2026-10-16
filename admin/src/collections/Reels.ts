import type { CollectionConfig } from 'payload';
import { TRADES, checkDate } from '@content-rules';
import { isOwner, readPublishedOrOwner, readVersionsOwnerOnly } from '../access';

export const Reels: CollectionConfig = {
  slug: 'reels',
  labels: { singular: '影片', plural: '影片' },
  admin: { useAsTitle: 'title' },
  versions: { drafts: { autosave: false }, maxPerDoc: 10 },
  access: { read: readPublishedOrOwner, readVersions: readVersionsOwnerOnly, create: isOwner, update: isOwner, delete: isOwner },
  fields: [
    { name: 'title', type: 'text', required: true },
    // → https://media.jackywu.ca/video/<id>/1080p.mp4
    { name: 'videoId', type: 'text', required: true, unique: true, index: true, validate: (x: unknown) => (typeof x === 'string' && /^[a-z0-9-]+$/.test(x) ? true : '只能用小寫英數與連字號') },
    { name: 'poster', type: 'upload', relationTo: 'media' },
    { name: 'posterAlt', type: 'text', required: true },
    { name: 'duration', type: 'number', min: 1 },
    { name: 'bytes', type: 'number', min: 1 },
    { name: 'ratio', type: 'select', defaultValue: '16/9', options: ['16/9', '9/16', '4/3', '1/1'] },
    { name: 'realm', type: 'select', required: true, options: [...TRADES] },
    { name: 'date', type: 'text', required: true, validate: (x: unknown) => (typeof x === 'string' && x ? (checkDate(x) ?? true) : true) },
    { name: 'caption', type: 'text', maxLength: 120 },
    {
      // 轉碼工作的狀態（規則在 src/lib/video-job.ts）。畫面唯讀，只由上傳與轉碼流程改動
      name: 'transcode',
      type: 'group',
      admin: { readOnly: true },
      fields: [
        { name: 'status', type: 'select', defaultValue: 'none', options: ['none', 'uploading', 'queued', 'running', 'done', 'failed'] },
        { name: 'attempts', type: 'number', defaultValue: 0 },
        { name: 'error', type: 'text' },
        { name: 'sourceKey', type: 'text' },
        { name: 'uploadId', type: 'text' },
        { name: 'startedAt', type: 'number' },
        { name: 'finishedAt', type: 'number' },
        // 容器最後一次心跳：看門狗靠它分辨「轉得慢」和「容器死了」
        { name: 'heartbeatAt', type: 'number' },
        // 開始上傳的時間：上傳到一半就沒下文的，一天後收掉
        { name: 'uploadStartedAt', type: 'number' },
      ],
    },
  ],
};
