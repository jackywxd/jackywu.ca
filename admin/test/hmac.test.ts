import { describe, expect, it } from 'vitest';
import { sign, verify, WINDOW_SEC } from '../src/lib/hmac';

const S = 'a-long-test-secret';
const body = JSON.stringify({ requestId: 'x', ok: true });

describe('hmac', () => {
  it('簽了就驗得過', async () => {
    expect(await verify(S, body, await sign(S, body, 1000), 1000)).toEqual({ ok: true });
  });
  it('內容被改 → 不符', async () => {
    const h = await sign(S, body, 1000);
    expect(await verify(S, body.replace('true', 'false'), h, 1000)).toMatchObject({ ok: false, reason: '簽章不符' });
  });
  it('secret 不對 → 不符', async () => {
    expect(await verify('other', body, await sign(S, body, 1000), 1000)).toMatchObject({ ok: false });
  });
  it('剛好在時間窗邊緣通過，多一秒就過期', async () => {
    const h = await sign(S, body, 1000);
    expect((await verify(S, body, h, 1000 + WINDOW_SEC)).ok).toBe(true);
    expect(await verify(S, body, h, 1000 + WINDOW_SEC + 1)).toMatchObject({ ok: false, reason: '簽章已過期' });
    expect(await verify(S, body, h, 1000 - WINDOW_SEC - 1)).toMatchObject({ ok: false, reason: '簽章已過期' });
  });
  it.each([null, '', 'garbage', 't=1,v1=zz', 't=abc,v1=' + 'a'.repeat(64), 'v1=' + 'a'.repeat(64)])('格式不對 %j → 拒絕', async (h) => {
    expect(await verify(S, body, h, 1000)).toMatchObject({ ok: false, reason: '簽章格式不對' });
  });
  it('伺服器沒設 secret → 一律拒絕（不是一律放行）', async () => {
    expect(await verify('', body, 't=1000,v1=' + 'a'.repeat(64), 1000)).toMatchObject({ ok: false });
    await expect(sign('', body)).rejects.toThrow();
  });
});
