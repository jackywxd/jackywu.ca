import { describe, expect, it } from 'vitest';
import { emailConflicts, importBlocks, managedElsewhere, sanitizeAccessApp, sanitizeBindings, sanitizeIdp, sanitizeServiceToken } from './discover';

// 快照會進公開 repo：每一類都只留白名單欄位
const CANARY = 'CANARY-should-never-reach-the-snapshot';

describe('快照白名單', () => {
  it('binding 只留名稱與型別（值不進快照）', () => {
    const out = JSON.stringify(sanitizeBindings([{ name: 'X', type: 'plain_text', text: CANARY }, { name: 'S', type: 'secret_text', text: CANARY }]));
    expect(out).not.toContain(CANARY);
    expect(JSON.parse(out)).toEqual([{ name: 'X', type: 'plain_text' }, { name: 'S', type: 'secret_text' }]);
  });
  it('IdP 的 config（可能有 OAuth client secret）不進快照', () =>
    expect(JSON.stringify(sanitizeIdp({ id: '1', name: 'otp', type: 'onetimepin', config: { client_secret: CANARY } }))).not.toContain(CANARY));
  it('service token 不留 client_id 與 secret', () =>
    expect(JSON.stringify(sanitizeServiceToken({ id: '1', name: 'ci', client_id: CANARY, client_secret: CANARY, expires_at: 'x' }))).not.toContain(CANARY));
  it('Access app 不帶白名單以外的欄位', () =>
    expect(JSON.stringify(sanitizeAccessApp({ id: '1', domain: 'a', saas_app: { client_secret: CANARY } }))).not.toContain(CANARY));
  it('不是陣列的 bindings → 空陣列', () => expect(sanitizeBindings(undefined)).toEqual([]));
});

describe('managedElsewhere：tofu 不能接手的 DNS 記錄', () => {
  const w = new Set(['admin.jackywu.ca']), r = new Set(['media.jackywu.ca']);
  it.each([
    [{ name: 'admin.jackywu.ca', type: 'AAAA' }, /Worker/],
    [{ name: 'media.jackywu.ca', type: 'CNAME' }, /R2/],
    [{ name: 'x.jackywu.ca', meta: { read_only: true } }, /read_only/],
    [{ name: 'jackywu.ca', type: 'MX', meta: { email_routing: true } }, /Email Routing/],
  ])('%j → 不歸 tofu', (rec, why) => expect(managedElsewhere(rec, w, r)).toMatch(why));
  it('一般記錄 → 歸 tofu', () => expect(managedElsewhere({ name: 'jackywu.ca', type: 'TXT' }, w, r)).toBeNull());
});

it('emailConflicts：只挑 apex 上的 MX 與 SPF', () => {
  const recs = [{ name: 'jackywu.ca', type: 'MX' }, { name: 'jackywu.ca', type: 'TXT', content: '"v=spf1 -all"' }, { name: 'jackywu.ca', type: 'TXT', content: 'google-site-verification=x' }, { name: 'a.jackywu.ca', type: 'MX' }];
  expect(emailConflicts(recs)).toHaveLength(2);
});

describe('importBlocks', () => {
  const base = { zoneId: 'z', apps: [], policies: [], idps: [], rulesets: [] };
  it('同名同型別的記錄位址不重複', () => {
    const hcl = importBlocks({ ...base, dns: [{ id: '1', type: 'TXT', name: 'jackywu.ca' }, { id: '2', type: 'TXT', name: 'jackywu.ca' }] });
    expect(hcl).toContain('cloudflare_dns_record.txt_apex\n');
    expect(hcl).toContain('cloudflare_dns_record.txt_apex_2\n');
    expect(hcl).toContain('id = "z/2"');
  });
  it('D1 與 bucket 一定有（id 是已知的）', () => {
    const hcl = importBlocks({ ...base, dns: [] });
    expect(hcl).toContain('cloudflare_d1_database.admin\n');
    expect(hcl).toContain('/hongchen-admin-private/default"');
  });
});
