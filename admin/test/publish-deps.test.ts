import { describe, expect, it } from 'vitest';
import { apiBaseFromEnv } from '../src/lib/publish-deps';

describe('apiBaseFromEnv', () => {
  it('沒設或預設值 → undefined（用 api.github.com）', () => {
    expect(apiBaseFromEnv(undefined)).toBeUndefined();
    expect(apiBaseFromEnv('')).toBeUndefined();
    expect(apiBaseFromEnv('https://api.github.com')).toBeUndefined();
  });
  it.each(['http://127.0.0.1:9999', 'http://localhost:8080', 'http://[::1]:1'])('本機位址 %s 放行', (v) => expect(apiBaseFromEnv(v)).toBe(v));
  it.each(['https://evil.example.com', 'http://127.0.0.1.evil.com', 'http://evil.com:80', 'https://127.0.0.1', 'http://localhost.evil.com'])('其他位址 %s → 丟錯（token 不能被送到別的主機）', (v) =>
    expect(() => apiBaseFromEnv(v)).toThrow(/GITHUB_API_BASE/));
});

import { liveManifestFrom } from '../src/lib/publish-deps';
describe('liveManifestFrom：讀線上的 content-manifest.json', () => {
  const site = 'https://jackywu.ca';
  const f = (status: number, body: unknown) => async (url: string | URL | Request) => {
    expect(String(url)).toBe('https://jackywu.ca/content-manifest.json');
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  it('取出 requestId 與 promoted', async () =>
    expect(await liveManifestFrom(site, f(200, { requestId: 'a'.repeat(22), promoted: ['video/a/1080p.mp4'] }) as typeof fetch)()).toEqual({ requestId: 'a'.repeat(22), promoted: ['video/a/1080p.mp4'] }));
  it('404 或壞 JSON → null（不能當成證據）', async () => {
    expect(await liveManifestFrom(site, f(404, 'nope') as typeof fetch)()).toBeNull();
    expect(await liveManifestFrom(site, f(200, '{bad') as typeof fetch)()).toBeNull();
  });
  it('promoted 裡有怪東西就丟掉，不信任', async () =>
    expect(await liveManifestFrom(site, f(200, { requestId: 'x', promoted: [1, 'gpx/a.gpx'] }) as typeof fetch)()).toEqual({ requestId: 'x', promoted: ['gpx/a.gpx'] }));
});

import { depsFromEnv } from '../src/lib/publish-deps';
describe('depsFromEnv：沒有設定 GitHub App 的環境（staging）', () => {
  const KEYS = ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY'] as const;
  const withEnv = async (vals: Partial<Record<(typeof KEYS)[number], string>>, fn: () => Promise<void>) => {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) { if (vals[k] === undefined) delete process.env[k]; else process.env[k] = vals[k]; }
    try { await fn(); } finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  };
  it('建得起來（刪除從沒上線過的草稿用不到 GitHub，先前在這裡就丟錯、整個請求 500）；說得出缺什麼；真的派送時才丟錯', () =>
    withEnv({}, async () => {
      const d = depsFromEnv({ payload: {} } as never);
      expect(d.dispatchUnavailable?.()).toMatch(/GITHUB_APP_ID/);
      await expect(d.github.dispatch({ requestId: 'r', kind: 'publish', collection: 'tales', docId: '1', versionId: '1', attempt: 1 })).rejects.toThrow(/缺少環境變數 GITHUB_APP_ID/);
    }));
  it('三個都設了：可以派送', () =>
    withEnv({ GITHUB_APP_ID: '1', GITHUB_APP_INSTALLATION_ID: '2', GITHUB_APP_PRIVATE_KEY: 'k' }, async () => {
      expect(depsFromEnv({ payload: {} } as never).dispatchUnavailable?.()).toBeNull();
    }));
});

