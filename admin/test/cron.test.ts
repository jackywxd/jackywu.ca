import { describe, expect, it } from 'vitest';
import { runSweeps, SWEEPS } from '../cron/index';
import { verify } from '../src/lib/hmac';

const S = 'cron-secret';
function admin(plan: (path: string, n: number) => number | Error) {
  const calls: { path: string; sig: string | null; method: string }[] = [];
  const counts = new Map<string, number>();
  return { calls, binding: { fetch: async (r: Request) => {
    const path = new URL(r.url).pathname; const n = (counts.get(path) ?? 0) + 1; counts.set(path, n);
    calls.push({ path, sig: r.headers.get('x-signature'), method: r.method });
    const p = plan(path, n); if (p instanceof Error) throw p; return new Response('', { status: p });
  } } };
}

describe('排程', () => {
  it('兩個看門狗都叫，用 POST 與 HMAC 簽章（後台驗得過）', async () => {
    const a = admin(() => 200);
    const r = await runSweeps({ ADMIN: a.binding, PUBLISH_HMAC_SECRET: S }, 1_800_000_000_000, () => {});
    expect(r).toEqual(SWEEPS.map((path) => ({ path, ok: true, status: 200 })));
    for (const c of a.calls) { expect(c.method).toBe('POST'); expect((await verify(S, '', c.sig, 1_800_000_000)).ok).toBe(true); }
  });
  it('失敗會重試一次；兩次都失敗只是回報 ok:false，不丟例外、不影響另一個', async () => {
    const a = admin((p, n) => (p === SWEEPS[0] ? 503 : n === 1 ? new Error('network') : 200));
    const logs: string[] = [];
    const r = await runSweeps({ ADMIN: a.binding, PUBLISH_HMAC_SECRET: S }, 0, (m) => logs.push(m));
    expect(r[0]).toMatchObject({ ok: false, status: 503 });
    expect(r[1]).toMatchObject({ ok: true });                       // 第一次丟錯、重試成功
    expect(a.calls.filter((c) => c.path === SWEEPS[0])).toHaveLength(2);
    expect(logs.length).toBeGreaterThan(0);
  });
  it('沒有設簽章金鑰 → 直接丟錯（不是送出沒有簽章的請求）', async () => {
    await expect(runSweeps({ ADMIN: admin(() => 200).binding, PUBLISH_HMAC_SECRET: '' })).rejects.toThrow(/PUBLISH_HMAC_SECRET/);
  });
});
