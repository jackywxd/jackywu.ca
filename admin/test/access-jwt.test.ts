import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveIdentity, type AccessConfig } from '../src/lib/access-jwt';

const TEAM = 'https://test-team.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const cfg: AccessConfig = { teamDomain: TEAM, aud: AUD, allowedEmails: ['me@example.com'] };

let sign: (claims: Record<string, unknown>, opts?: { aud?: string; iss?: string; exp?: string }) => Promise<string>;
let getKey: ReturnType<typeof createLocalJWKSet>;
let otherSign: typeof sign;

async function makeSigner() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k1' };
  const s: typeof sign = (claims, o = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(o.iss ?? TEAM)
      .setAudience(o.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? '5m')
      .sign(privateKey);
  return { jwk, s };
}

const req = (token?: string, hostname = 'admin.jackywu.ca') => ({
  headers: new Headers(token ? { 'cf-access-jwt-assertion': token } : {}),
  hostname,
});

beforeAll(async () => {
  const a = await makeSigner();
  sign = a.s;
  getKey = createLocalJWKSet({ keys: [a.jwk] });
  otherSign = (await makeSigner()).s; // 另一把金鑰：簽章對不上
});

describe('resolveIdentity', () => {
  it('合法的人類 JWT → user', async () => {
    const id = await resolveIdentity(req(await sign({ email: 'Me@Example.com' })), cfg, getKey);
    expect(id).toEqual({ kind: 'user', email: 'me@example.com' });
  });
  it('服務憑證（無 email、有 common_name）→ service', async () => {
    const id = await resolveIdentity(req(await sign({ common_name: 'abc.access' })), cfg, getKey);
    expect(id).toEqual({ kind: 'service', clientId: 'abc.access' });
  });
  it('沒有 JWT → 401', async () => {
    await expect(resolveIdentity(req(), cfg, getKey)).rejects.toMatchObject({ status: 401 });
  });
  it('aud 錯誤 → 401', async () => {
    const t = await sign({ email: 'me@example.com' }, { aud: 'b'.repeat(64) });
    await expect(resolveIdentity(req(t), cfg, getKey)).rejects.toMatchObject({ status: 401 });
  });
  it('iss 錯誤 → 401', async () => {
    const t = await sign({ email: 'me@example.com' }, { iss: 'https://evil.example.com' });
    await expect(resolveIdentity(req(t), cfg, getKey)).rejects.toMatchObject({ status: 401 });
  });
  it('已過期 → 401', async () => {
    const t = await sign({ email: 'me@example.com' }, { exp: '-1m' });
    await expect(resolveIdentity(req(t), cfg, getKey)).rejects.toMatchObject({ status: 401 });
  });
  it('簽章金鑰不是 Access 的 → 401', async () => {
    const t = await otherSign({ email: 'me@example.com' });
    await expect(resolveIdentity(req(t), cfg, getKey)).rejects.toMatchObject({ status: 401 });
  });
  it('簽章合法但 email 不在名單 → 401', async () => {
    const t = await sign({ email: 'stranger@example.com' });
    await expect(resolveIdentity(req(t), cfg, getKey)).rejects.toMatchObject({ status: 401 });
  });
  it('沒有 email 也沒有 common_name → 401', async () => {
    await expect(resolveIdentity(req(await sign({ sub: 'x' })), cfg, getKey)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('設定錯誤要大聲失敗', () => {
  it('ACCESS_TEAM_DOMAIN 沒設 → throw 設定事故，不是默默 401', async () => {
    const bad = { ...cfg, teamDomain: '' };
    const err = await resolveIdentity(req('a.b.c'), bad).catch((e) => e);
    expect(err.status).toBeUndefined();
    expect(err.message).toMatch(/ACCESS_TEAM_DOMAIN/);
  });
});

describe('dev bypass', () => {
  const dev = { ...cfg, devBypassEmail: 'Me@Example.com' };
  it.each(['localhost', '127.0.0.1', '[::1]'])('在 %s 放行', async (host) => {
    expect(await resolveIdentity(req(undefined, host), dev, getKey)).toEqual({
      kind: 'user',
      email: 'me@example.com',
    });
  });
  it.each(['admin.jackywu.ca', 'admin-staging.jackywu.ca', 'x.workers.dev', 'localhost.evil.com'])(
    '在 %s 直接 throw（不是 401，是設定事故）',
    async (host) => {
      const err = await resolveIdentity(req(undefined, host), dev, getKey).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBeUndefined();
      expect(err.message).toMatch(/只能在 localhost/);
    },
  );
});
