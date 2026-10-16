import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { githubApp, type GitHubConfig } from '../src/lib/github-app';

let cfg: GitHubConfig;
let publicKey: CryptoKey;
beforeAll(async () => {
  const kp = await generateKeyPair('RS256', { extractable: true });
  publicKey = kp.publicKey;
  cfg = { appId: '123', installationId: '456', privateKey: await exportPKCS8(kp.privateKey), repo: 'o/r' };
});

const RID = 'abcdefghij0123456789ab';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function fake(handlers: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return handlers(url, init); }) as unknown as typeof fetch;
  return { f, calls };
}

describe('githubApp', () => {
  it('用 App 的 JWT 換 installation token，再送 dispatch', async () => {
    const { f, calls } = fake((url, init) => {
      if (url.endsWith('/access_tokens')) return json({ token: 'tok', expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
      if (url.endsWith('/dispatches')) return new Response(null, { status: 204 });
      return json({}, 404);
    });
    await githubApp(cfg, f).dispatch({ requestId: RID, kind: 'publish', collection: 'tales', docId: '1', versionId: '2' });
    const tokenCall = calls[0]!;
    const jwt = String((tokenCall.init.headers as Record<string, string>).authorization).replace('Bearer ', '');
    const { payload } = await jwtVerify(jwt, publicKey, { issuer: '123' });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(600);
    const d = calls[1]!;
    expect((d.init.headers as Record<string, string>).authorization).toBe('token tok');
    expect(JSON.parse(String(d.init.body))).toEqual({ event_type: 'content-publish', client_payload: { requestId: RID, kind: 'publish', collection: 'tales', docId: '1', versionId: '2' } });
  });
  it('installation token 快取：第二次 dispatch 不再換 token', async () => {
    const { f, calls } = fake((url) => url.endsWith('/access_tokens') ? json({ token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201) : new Response(null, { status: 204 }));
    const g = githubApp(cfg, f);
    const p = { requestId: RID, kind: 'publish', collection: 'tales', docId: '1', versionId: '2' };
    await g.dispatch(p); await g.dispatch(p);
    expect(calls.filter((c) => c.url.endsWith('/access_tokens'))).toHaveLength(1);
  });
  it('requestId 格式不對 → 在送出前就擋下（不打 GitHub）', async () => {
    const { f, calls } = fake(() => json({}));
    await expect(githubApp(cfg, f).dispatch({ requestId: 'x; rm -rf /', kind: 'publish', collection: 'tales', docId: '1', versionId: '2' })).rejects.toThrow(/格式/);
    expect(calls).toHaveLength(0);
  });
  it('GitHub 回非 204 → 丟錯（呼叫端據此保留 queued）', async () => {
    const { f } = fake((url) => url.endsWith('/access_tokens') ? json({ token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201) : json({ message: 'nope' }, 422));
    await expect(githubApp(cfg, f).dispatch({ requestId: RID, kind: 'publish', collection: 'tales', docId: '1', versionId: '2' })).rejects.toThrow(/422/);
  });
  describe('runConclusion', () => {
    const runs = (...r: object[]) => fake((url) => url.endsWith('/access_tokens') ? json({ token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201) : json({ workflow_runs: r }));
    it('找到對應 requestId 的 run', async () => {
      const { f } = runs({ display_title: `publish ${RID}`, status: 'completed', conclusion: 'cancelled' }, { display_title: 'publish other', status: 'completed', conclusion: 'success' });
      expect(await githubApp(cfg, f).runConclusion(RID)).toBe('cancelled');
    });
    it('進行中 → in_progress；找不到 → unknown', async () => {
      expect(await githubApp(cfg, runs({ display_title: `publish ${RID}`, status: 'in_progress', conclusion: null }).f).runConclusion(RID)).toBe('in_progress');
      expect(await githubApp(cfg, runs().f).runConclusion(RID)).toBe('unknown');
    });
    it('不認得的結論（skipped、neutral）當成失敗，不當成成功', async () => {
      expect(await githubApp(cfg, runs({ display_title: RID, status: 'completed', conclusion: 'skipped' }).f).runConclusion(RID)).toBe('failure');
    });
  });
});
