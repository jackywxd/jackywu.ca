import { describe, expect, it } from 'vitest';
import { handleSend } from '../mailer/handler';
import { emailNotifier } from '../src/lib/notify';

const env = { NOTIFY_FROM: 'admin@jackywu.ca', NOTIFY_TO: 'me@example.com' };
const post = (body: unknown, path = '/send', method = 'POST') => new Request(`https://mailer${path}`, { method, body: method === 'POST' ? JSON.stringify(body) : undefined });

describe('mailer', () => {
  it('寄件人與收件人只來自設定：後台塞進 to／from 也沒用', async () => {
    const sent: { from: string; to: string; raw: string }[] = [];
    const r = await handleSend(post({ subject: '主旨', text: '內文', to: 'evil@x.com', from: 'ceo@y.com' }), env, async (from, to, raw) => void sent.push({ from, to, raw }));
    expect(r.status).toBe(202);
    expect(sent[0]).toMatchObject({ from: 'admin@jackywu.ca', to: 'me@example.com' });
    expect(sent[0]!.raw).not.toContain('evil@x.com');
  });
  it.each([[{ subject: '', text: 'x' }], [{ subject: 'x' }], [{ subject: 1, text: 'x' }], [{ subject: 'x'.repeat(201), text: 'x' }], [{ subject: 'x', text: 'x'.repeat(20_001) }]])('欄位不對 %j → 400，沒有寄信', async (b) => {
    let n = 0;
    expect((await handleSend(post(b), env, async () => void n++)).status).toBe(400);
    expect(n).toBe(0);
  });
  it('只有 POST /send', async () => {
    expect((await handleSend(post({}, '/other'), env, async () => {})).status).toBe(404);
    expect((await handleSend(new Request('https://mailer/send', { method: 'GET' }), env, async () => {})).status).toBe(404);
  });
  it('沒設定收件人 → 500（不是寄給 undefined）', async () => {
    expect((await handleSend(post({ subject: 'a', text: 'b' }), { NOTIFY_FROM: '', NOTIFY_TO: '' }, async () => {})).status).toBe(500);
  });
  it('寄信失敗 → 502 並說明原因', async () => {
    const r = await handleSend(post({ subject: 'a', text: 'b' }), env, async () => { throw new Error('destination address not verified'); });
    expect(r.status).toBe(502); expect(await r.text()).toContain('not verified');
  });
});

describe('後台端的 deliver', () => {
  it('只交出主旨與內文；mailer 回錯誤時記 log、不丟例外', async () => {
    const got: unknown[] = [], logs: string[] = [];
    const n = emailNotifier({ from: 'x', to: 'y', adminUrl: 'https://a', log: (m) => logs.push(m), send: async () => {}, deliver: async (m) => { got.push(m); throw new Error('mailer 回 502'); } });
    await n({ kind: 'published', request: { id: 'a'.repeat(22), kind: 'publish', collection: 'tales', docId: '1', versionId: '2', status: 'deployed', attempts: 1, createdAt: 0 } });
    expect(Object.keys(got[0] as object).sort()).toEqual(['subject', 'text']);
    expect(logs[0]).toContain('502');
  });
});
