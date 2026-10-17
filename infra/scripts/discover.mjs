#!/usr/bin/env node
/**
 * M0：唯讀地列出既有資源，寫出兩個檔案：
 *   infra/discovery/snapshot.json   非機密的設定快照（白名單欄位，見 packages/infra/discover.ts）
 *   infra/discovery/imports.draft.tf import 區塊草稿
 *
 * 只發 GET。需要一把唯讀 token（放 shell 環境，不要寫進檔案）：
 *   CLOUDFLARE_API_TOKEN  權限：Account Settings / Access: Apps and Policies / Access: Service Tokens /
 *                         D1 / Workers R2 Storage / Workers Scripts / Email Routing Addresses（以上 Read），
 *                         Zone、DNS、Zone Settings、Config Rules/Cache Rules（Read）、Email Routing Rules（Read）
 *   Workers Builds 只接受 user token；用 account token 時那一段會標成「無法確認」，去 dashboard 看即可。
 * GitHub 部分用已登入的 gh。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  ACCOUNT_ID, BUCKETS, D1, WORKERS, ZONE_NAME, emailConflicts, importBlocks, managedElsewhere,
  sanitizeAccessApp, sanitizeBindings, sanitizeDns, sanitizeIdp, sanitizePolicy, sanitizeRuleset, sanitizeServiceToken,
} from '../../packages/infra/discover.ts';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) { console.error('需要 CLOUDFLARE_API_TOKEN（唯讀）'); process.exit(1); }
const A = `/accounts/${ACCOUNT_ID}`;
const problems = [];

/** 只有 GET；失敗回 null 並記下（狀態碼與 Cloudflare 的錯誤代碼，不印回應內容） */
async function get(path, { all = false } = {}) {
  const out = [];
  for (let page = 1; ; page++) {
    const url = new URL(`https://api.cloudflare.com/client/v4${path}`);
    if (all) { url.searchParams.set('page', String(page)); url.searchParams.set('per_page', '100'); }
    const r = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      problems.push(`${path}：HTTP ${r.status} ${(j.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ')}`);
      return null;
    }
    if (!all) return j.result;
    out.push(...(j.result ?? []));
    const info = j.result_info ?? {};
    if (!info.total_pages || page >= info.total_pages) return out;
  }
}
const gh = (path) => {
  try { return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch (e) { problems.push(`gh api ${path}：${String(e.stderr ?? e.message).split('\n')[0]}`); return null; }
};

const zone = (await get(`/zones?name=${ZONE_NAME}`))?.[0];
if (!zone) { console.error(problems.join('\n')); process.exit(1); }
const Z = `/zones/${zone.id}`;

const d1 = {};
for (const [k, id] of Object.entries(D1)) {
  const r = await get(`${A}/d1/database/${id}`);
  d1[k] = r && { uuid: r.uuid, name: r.name, created_at: r.created_at, primary_location_hint: r.primary_location_hint, read_replication: r.read_replication };
}

const r2 = {};
for (const [k, b] of Object.entries(BUCKETS)) {
  const bucket = await get(`${A}/r2/buckets/${b}`);
  r2[k] = {
    bucket: bucket && { name: bucket.name, location: bucket.location, jurisdiction: bucket.jurisdiction, storage_class: bucket.storage_class },
    lifecycle: (await get(`${A}/r2/buckets/${b}/lifecycle`))?.rules ?? null,
    managed_domain: await get(`${A}/r2/buckets/${b}/domains/managed`),
    custom_domains: ((await get(`${A}/r2/buckets/${b}/domains/custom`))?.domains ?? []).map((d) => ({ domain: d.domain, enabled: d.enabled, zoneName: d.zoneName, minTLS: d.minTLS })),
  };
}

const apps = ((await get(`${A}/access/apps`, { all: true })) ?? []).map(sanitizeAccessApp);
const policies = ((await get(`${A}/access/policies`, { all: true })) ?? []).map(sanitizePolicy);
const idps = ((await get(`${A}/access/identity_providers`, { all: true })) ?? []).map(sanitizeIdp);
const serviceTokens = ((await get(`${A}/access/service_tokens`, { all: true })) ?? []).map(sanitizeServiceToken);
const org = await get(`${A}/access/organizations`);

const workerDomains = (await get(`${A}/workers/domains`, { all: true })) ?? [];
const workerHosts = new Set(workerDomains.map((d) => d.hostname));
const r2Hosts = new Set(Object.values(r2).flatMap((x) => x.custom_domains.map((d) => d.domain)));
const allDns = ((await get(`${Z}/dns_records`, { all: true })) ?? []).map(sanitizeDns);
const dnsOwned = [], dnsSkipped = [];
for (const r of allDns) { const why = managedElsewhere(r, workerHosts, r2Hosts); (why ? dnsSkipped : dnsOwned).push(why ? { ...r, skipped: why } : r); }

const PHASES = ['http_request_dynamic_redirect', 'http_request_cache_settings', 'http_request_transform', 'http_response_headers_transform', 'http_config_settings'];
const rulesets = [];
for (const rs of (await get(`${Z}/rulesets`)) ?? []) {
  if (rs.kind !== 'zone' || !PHASES.includes(rs.phase)) continue;
  const full = await get(`${Z}/rulesets/${rs.id}`);
  if (full) rulesets.push(sanitizeRuleset(full));
}

const settings = {};
for (const s of ['ssl', 'always_use_https', 'min_tls_version', 'tls_1_3', 'automatic_https_rewrites', 'http3', 'brotli']) {
  const r = await get(`${Z}/settings/${s}`);
  settings[s] = r?.value ?? null;
}

const emailRouting = await get(`${Z}/email/routing`);
const emailAddresses = ((await get(`${A}/email/routing/addresses`, { all: true })) ?? []).map((a) => ({ id: a.id, email: a.email, verified: a.verified }));

const scripts = (await get(`${A}/workers/scripts`)) ?? [];
const workers = {};
for (const name of WORKERS) {
  const s = scripts.find((x) => x.id === name);
  if (!s) { workers[name] = { exists: false }; continue; }
  const settingsW = await get(`${A}/workers/scripts/${name}/settings`);
  const secrets = ((await get(`${A}/workers/scripts/${name}/secrets`)) ?? []).map((x) => x.name);
  const before = problems.length;
  const triggers = await get(`${A}/builds/workers/${s.tag}/triggers`);
  const builds = triggers === null ? '無法確認（Builds API 只接受 user token；去 dashboard 的 Settings → Builds 看）' : triggers.map((t) => ({ trigger_name: t.trigger_name, branch_includes: t.branch_includes }));
  if (triggers === null) problems.splice(before);
  workers[name] = { exists: true, modified_on: s.modified_on, bindings: sanitizeBindings(settingsW?.bindings), secret_names: secrets, workers_builds: builds };
}

const repo = 'repos/jackywxd/jackywu.ca';
const github = {
  environments: (gh(`${repo}/environments`)?.environments ?? []).map((e) => ({ name: e.name, protection_rules: (e.protection_rules ?? []).map((p) => p.type), deployment_branch_policy: e.deployment_branch_policy })),
  secret_names: (gh(`${repo}/actions/secrets`)?.secrets ?? []).map((s) => s.name),
  variable_names: (gh(`${repo}/actions/variables`)?.variables ?? []).map((v) => v.name),
};

const snapshot = {
  taken_at: new Date().toISOString(), account_id: ACCOUNT_ID, zone: { id: zone.id, name: zone.name, plan: zone.plan?.legacy_id },
  d1, r2,
  access: { team_domain: org?.auth_domain ? `https://${org.auth_domain}` : null, apps, policies, idps, service_tokens: serviceTokens },
  dns: { owned_by_tofu: dnsOwned, managed_elsewhere: dnsSkipped, email_routing_conflicts: emailConflicts(allDns) },
  rulesets, zone_settings: settings,
  email_routing: emailRouting && { enabled: emailRouting.enabled, status: emailRouting.status, addresses: emailAddresses },
  workers, github,
  problems,
};

mkdirSync('infra/discovery', { recursive: true });
writeFileSync('infra/discovery/snapshot.json', JSON.stringify(snapshot, null, 2) + '\n');
writeFileSync('infra/discovery/imports.draft.tf', importBlocks({ zoneId: zone.id, apps, policies, idps, dns: dnsOwned, rulesets }));
console.log(`✓ 快照：infra/discovery/snapshot.json（DNS ${dnsOwned.length} 筆歸 tofu、${dnsSkipped.length} 筆不歸；rulesets ${rulesets.length}；Access apps ${apps.length}）`);
console.log('✓ import 草稿：infra/discovery/imports.draft.tf');
if (problems.length) { console.log(`\n有 ${problems.length} 項讀不到（多半是 token 少了某個 Read 權限）：`); for (const p of problems) console.log(`  · ${p}`); }
