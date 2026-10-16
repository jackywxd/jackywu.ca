import { describe, expect, it } from 'vitest';
import { accessConfigFromEnv, isCrossSiteWrite, serviceRole } from '../src/lib/access-strategy';

describe('服務憑證的角色：只有登記過的 client id 才有角色', () => {
  const cfg = accessConfigFromEnv({ ACCESS_CI_CLIENT_ID: 'ci-123.access' });
  it('CI 的 client id → reader', () => expect(serviceRole('ci-123.access', cfg)).toBe('reader'));
  it('其他服務憑證（例如轉碼容器的）→ 沒有角色：它只走簽章網址，不需要讀任何集合', () =>
    expect(serviceRole('transcoder-9.access', cfg)).toBeNull());
  it('沒有設定 CI client id 時，任何服務憑證都沒有角色', () =>
    expect(serviceRole('ci-123.access', accessConfigFromEnv({}))).toBeNull());
});

describe('isCrossSiteWrite：別的網站替本人送出的寫入要擋（CSRF）', () => {
  const h = (o: Record<string, string>) => new Headers({ host: 'admin.jackywu.ca', ...o });
  it.each([
    ['POST，Sec-Fetch-Site: cross-site', 'POST', { 'sec-fetch-site': 'cross-site' }],
    ['POST，Sec-Fetch-Site: same-site（jackywu.ca 上被注入的頁面也算外來）', 'POST', { 'sec-fetch-site': 'same-site' }],
    ['PATCH，Origin 是別的網域', 'PATCH', { origin: 'https://evil.example' }],
    ['DELETE，Origin 是同站但不同主機', 'DELETE', { origin: 'https://jackywu.ca' }],
    ['POST，Origin 是 null（沙箱 iframe）', 'POST', { origin: 'null' }],
  ])('擋：%s', (_n, method, o) => expect(isCrossSiteWrite(method, h(o))).toBe(true));
  it.each([
    ['GET 跨站（例如從信件點連結進來）', 'GET', { 'sec-fetch-site': 'cross-site' }],
    ['POST，同源', 'POST', { 'sec-fetch-site': 'same-origin', origin: 'https://admin.jackywu.ca' }],
    ['POST，伺服器對伺服器（沒有 Origin、沒有 Sec-Fetch-*）', 'POST', {}],
    ['POST，使用者自己在網址列操作（none）', 'POST', { 'sec-fetch-site': 'none' }],
  ])('放：%s', (_n, method, o) => expect(isCrossSiteWrite(method, h(o))).toBe(false));
});
