import { describe, expect, it } from 'vitest';
import { render, summarize } from './plan-summary';

// 防的失敗：plan 摘要把秘密印進公開的 Actions log；或保護中的資源被刪掉而 CI 照樣綠燈
const CANARY = 'CANARY-secret-value-must-not-appear';
const rc = (address: string, type: string, actions: string[], extra: object = {}) =>
  ({ address, type, change: { actions, before: { value: CANARY }, after: { value: CANARY, nested: [CANARY] }, after_unknown: {}, ...extra } });

describe('summarize', () => {
  const plan = {
    resource_changes: [
      rc('cloudflare_d1_database.admin', 'cloudflare_d1_database', ['no-op'], { importing: { id: 'x' } }),
      rc('random_password.this["prod.PAYLOAD_SECRET"]', 'random_password', ['create']),
      rc('github_actions_secret.this["PUBLISH_HMAC_SECRET"]', 'github_actions_secret', ['update']),
      rc('cloudflare_account_token.state', 'cloudflare_account_token', ['create', 'delete']),
      rc('data.cloudflare_zero_trust_organization.this', 'cloudflare_zero_trust_organization', ['read']),
      rc('cloudflare_zone_setting.this["ssl"]', 'cloudflare_zone_setting', ['no-op']),
    ],
    output_changes: { worker_secrets: { actions: ['update'], after: { x: CANARY } } },
    variables: { state_passphrase: { value: CANARY } },
  };

  it('只輸出位址與動作，秘密一個字都不出現', () => {
    const text = render(summarize(plan));
    expect(text).not.toContain(CANARY);
    expect(text).toContain('<=import cloudflare_d1_database.admin');
    expect(text).toContain('+ random_password.this["prod.PAYLOAD_SECRET"]');
    expect(text).toContain('~ github_actions_secret.this["PUBLISH_HMAC_SECRET"]');
    expect(text).toContain('-/+ cloudflare_account_token.state');
  });
  it('no-op 與 data source 不列', () => {
    const s = summarize(plan);
    expect(s.lines.some((l) => l.includes('zone_setting') || l.includes('data.'))).toBe(false);
    expect(s.counts).toEqual({ import: 1, create: 1, update: 1, replace: 1, delete: 0 });
  });
  it.each([
    ['cloudflare_d1_database.admin', 'cloudflare_d1_database', ['delete']],
    ['cloudflare_r2_bucket.this["private"]', 'cloudflare_r2_bucket', ['delete', 'create']],
    ['github_repository_environment.production', 'github_repository_environment', ['create', 'delete']],
    ['cloudflare_zero_trust_access_application.this["admin"]', 'cloudflare_zero_trust_access_application', ['delete']],
  ])('刪除或取代受保護的 %s → blocked', (address, type, actions) =>
    expect(summarize({ resource_changes: [rc(address, type, actions)] }).blocked).toEqual([address]));
  it('取代 token 或亂數（輪替）不擋', () =>
    expect(summarize({ resource_changes: [rc('cloudflare_account_token.state', 'cloudflare_account_token', ['create', 'delete'])] }).blocked).toEqual([]));
  it('不是 plan JSON → 丟錯（不要把空摘要當成沒變更）', () => expect(() => summarize({})).toThrow(/resource_changes/));
  it('沒有變更時明說', () => expect(render(summarize({ resource_changes: [] }))).toContain('沒有變更'));
});
