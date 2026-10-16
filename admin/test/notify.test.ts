import { describe, expect, it } from 'vitest';
import { buildMime, emailNotifier, formatNotice } from '../src/lib/notify';
import type { PublishRequest } from '../src/lib/publish-queue';

const req = (over: Partial<PublishRequest> = {}): PublishRequest => ({ id: 'a'.repeat(22), kind: 'publish', collection: 'tales', docId: '12', versionId: '3', status: 'deployed', attempts: 1, createdAt: 0, ...over });
const A = 'https://admin.jackywu.ca';

describe('formatNotice', () => {
  it('成功', () => expect(formatNotice({ kind: 'published', request: req() }, A)).toMatchObject({ subject: '已上線：發佈 tales/12' }));
  it('失敗：主旨有檢查名稱，內文有原因、記錄連結、以及「網站維持上一版」', () => {
    const m = formatNotice({ kind: 'failed', request: req({ status: 'failed', failure: { check: 'verify-og-crop', summary: '✗ 1 張被裁掉', runUrl: 'https://github.com/o/r/actions/runs/9' } }) }, A)!;
    expect(m.subject).toContain('verify-og-crop');
    expect(m.text).toContain('✗ 1 張被裁掉'); expect(m.text).toContain('actions/runs/9'); expect(m.text).toContain('網站維持上一版'); expect(m.text).toContain(`${A}/system`);
  });
  it('看門狗與送不出去', () => {
    expect(formatNotice({ kind: 'watchdog', request: req(), detail: '超過時限' }, A)!.subject).toContain('卡住');
    expect(formatNotice({ kind: 'dispatch-error', request: req(), detail: 'GitHub 503' }, A)!.text).toContain('GitHub 503');
  });
  it('撤下與刪除的動作名稱正確', () => {
    expect(formatNotice({ kind: 'published', request: req({ kind: 'unpublish' }) }, A)!.subject).toContain('撤下');
    expect(formatNotice({ kind: 'published', request: req({ kind: 'delete' }) }, A)!.subject).toContain('刪除');
  });
});

describe('buildMime', () => {
  const mime = buildMime({ from: 'a@x.com', to: 'b@y.com', subject: '已上線：發佈 tales/12', text: '內文：中文與 emoji 🎉', messageId: 'id@x', date: new Date('2026-10-16T00:00:00Z') });
  it('非 ASCII 主旨用 RFC 2047 編碼，且能解回原文', () => {
    const m = mime.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)!;
    expect(new TextDecoder().decode(Uint8Array.from(atob(m[1]!), (c) => c.charCodeAt(0)))).toBe('已上線：發佈 tales/12');
  });
  it('內文是 base64，解開是原文；每行不超過 76 字元', () => {
    const body = mime.split('\r\n\r\n')[1]!.trim();
    expect(body.split('\r\n').every((l) => l.length <= 76)).toBe(true);
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)))).toBe('內文：中文與 emoji 🎉');
  });
  it('標頭齊全，ASCII 主旨不編碼', () => {
    expect(mime).toMatch(/^From: a@x\.com\r\nTo: b@y\.com\r\n/);
    expect(buildMime({ from: 'a@x', to: 'b@y', subject: 'plain', text: 't', messageId: 'i', date: new Date(0) })).toContain('Subject: plain\r\n');
  });
  it('標頭注入：主旨裡的換行被編碼，不會變成新的標頭', () => {
    const evil = buildMime({ from: 'a@x', to: 'b@y', subject: '正常\r\nBcc: evil@z.com', text: 't', messageId: 'i', date: new Date(0) });
    expect(evil).not.toMatch(/^Bcc:/m);
  });
});

describe('emailNotifier', () => {
  it('寄出一封信；寄信失敗只記 log，不丟例外（不能影響發佈）', async () => {
    const sent: string[] = [], logs: string[] = [];
    const ok = emailNotifier({ send: async (_f, _t, raw) => void sent.push(raw), from: 'a@x', to: 'b@y', adminUrl: A, log: (m) => logs.push(m) });
    await ok({ kind: 'published', request: req() });
    expect(sent).toHaveLength(1);
    const bad = emailNotifier({ send: async () => { throw new Error('destination not verified'); }, from: 'a@x', to: 'b@y', adminUrl: A, log: (m) => logs.push(m) });
    await expect(bad({ kind: 'failed', request: req({ failure: { check: 'x', summary: 'y' } }) })).resolves.toBeUndefined();
    expect(logs[0]).toContain('destination not verified');
  });
});
