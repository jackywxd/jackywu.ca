/**
 * 探索既有資源（infra/scripts/discover.mjs）的純邏輯：決定哪些欄位可以進快照、哪些 DNS 記錄不歸 tofu 管、
 * 以及產生 import 區塊的草稿。快照會進公開的 repo，所以每一類都是白名單，不是黑名單。
 */
export const ACCOUNT_ID = 'e92ee6e81173e12edb023ed5ee34faee';
export const ZONE_NAME = 'jackywu.ca';
export const D1 = { admin: '3b014573-73d8-4778-bd14-ce20e198f1c7', admin_staging: 'e19b49b0-eac7-4f62-a03b-2e8759c08bed' } as const;
export const BUCKETS = { private: 'hongchen-admin-private', private_staging: 'hongchen-admin-private-staging', media: 'zhuiyunzhuxue-media' } as const;
/** 要看 bindings 與 secret 名稱的 Worker（判斷 M5 要走哪條路） */
export const WORKERS = ['hongchen-inn', 'hongchen-admin', 'hongchen-admin-staging', 'hongchen-admin-cron', 'hongchen-admin-cron-staging', 'hongchen-mailer', 'hongchen-mailer-staging', 'hongchen-transcoder', 'hongchen-transcoder-staging'];

type Obj = Record<string, unknown>;
const pick = (o: Obj, keys: readonly string[]): Obj => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** 只留名稱與型別：plain_text 的值已經在 wrangler.jsonc 裡，secret 的值 API 本來就不回，但不靠它 */
export const sanitizeBindings = (b: unknown): Obj[] => (Array.isArray(b) ? b.map((x: Obj) => pick(x, ['name', 'type'])) : []);
export const sanitizeAccessApp = (a: Obj) => pick(a, ['id', 'name', 'type', 'domain', 'destinations', 'self_hosted_domains', 'aud', 'session_duration', 'policies', 'allowed_idps', 'auto_redirect_to_identity', 'app_launcher_visible', 'http_only_cookie_attribute', 'same_site_cookie_attribute']);
export const sanitizePolicy = (p: Obj) => pick(p, ['id', 'name', 'decision', 'include', 'exclude', 'require', 'session_duration', 'reusable']);
/** IdP 的 config 可能含 OAuth client secret：只留身分 */
export const sanitizeIdp = (p: Obj) => pick(p, ['id', 'name', 'type']);
/** service token：client_id 單獨不能用，但也不必進公開 repo；只留 id、名稱、期限 */
export const sanitizeServiceToken = (t: Obj) => pick(t, ['id', 'name', 'expires_at', 'duration']);
export const sanitizeDns = (r: Obj) => pick(r, ['id', 'type', 'name', 'content', 'proxied', 'ttl', 'priority', 'comment', 'meta']);
export const sanitizeRuleset = (r: Obj) => ({ ...pick(r, ['id', 'name', 'kind', 'phase']), rules: Array.isArray(r.rules) ? r.rules.map((x: Obj) => pick(x, ['id', 'description', 'expression', 'action', 'action_parameters', 'enabled'])) : [] });

/** 這筆 DNS 記錄由別人管（回傳原因），tofu 不能 import；null 表示可以交給 tofu */
export function managedElsewhere(r: Obj, workerHosts: ReadonlySet<string>, r2Hosts: ReadonlySet<string>): string | null {
  const meta = (r.meta ?? {}) as Obj;
  const name = String(r.name ?? '');
  if (meta.read_only) return 'read_only（Cloudflare 管）';
  if (workerHosts.has(name)) return 'Worker custom domain（wrangler 管）';
  if (r2Hosts.has(name)) return 'R2 custom domain';
  if (meta.email_routing) return 'Email Routing（由 email_routing_settings 管）';
  return null;
}

/** 開 Email Routing 之前要先處理的記錄：apex 上現有的 MX 與 SPF */
export function emailConflicts(records: readonly Obj[], zone = ZONE_NAME): Obj[] {
  return records.filter((r) => r.name === zone && (r.type === 'MX' || (r.type === 'TXT' && /v=spf1/i.test(String(r.content ?? '')))));
}

const slug = (s: string) => s.toLowerCase().replace(/\.?jackywu\.ca$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'apex';

/** 產生 import 區塊草稿。位址是暫定的，整理進正式檔案時可以改名（改名後 import 的 to 也要跟著改） */
export function importBlocks(s: { zoneId: string; apps: Obj[]; policies: Obj[]; idps: Obj[]; dns: Obj[]; rulesets: Obj[] }): string {
  const out: string[] = ['# 由 infra/scripts/discover.mjs 產生的草稿。整理進正式檔案後刪掉這個檔案。'];
  const add = (to: string, id: string) => out.push(`import {\n  to = ${to}\n  id = "${id}"\n}`);
  for (const [k, id] of Object.entries(D1)) add(`cloudflare_d1_database.${k}`, `${ACCOUNT_ID}/${id}`);
  for (const [k, b] of Object.entries(BUCKETS)) add(`cloudflare_r2_bucket.${k}`, `${ACCOUNT_ID}/${b}/default`);
  for (const a of s.apps) add(`cloudflare_zero_trust_access_application.${slug(String(a.domain ?? a.name))}`, `accounts/${ACCOUNT_ID}/${a.id}`);
  for (const p of s.policies) add(`cloudflare_zero_trust_access_policy.${slug(String(p.name))}`, `${ACCOUNT_ID}/${p.id}`);
  for (const p of s.idps) add(`cloudflare_zero_trust_access_identity_provider.${slug(String(p.type ?? p.name))}`, `accounts/${ACCOUNT_ID}/${p.id}`);
  const seen = new Map<string, number>();
  for (const r of s.dns) {
    const base = `${String(r.type).toLowerCase()}_${slug(String(r.name))}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    add(`cloudflare_dns_record.${n > 1 ? `${base}_${n}` : base}`, `${s.zoneId}/${r.id}`);
  }
  for (const r of s.rulesets) add(`cloudflare_ruleset.${slug(String(r.phase))}`, `zones/${s.zoneId}/${r.id}`);
  return out.join('\n\n') + '\n';
}
