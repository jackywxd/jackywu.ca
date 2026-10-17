/**
 * `tofu show -json <plan>` → 只有「位址＋動作」的摘要（scripts/infra/plan-summary.mjs）。
 * repo 是公開的，Actions 的 log 誰都看得到，而 plan JSON 的 before／after 裡有明文的秘密，
 * 所以這裡只讀 address、type、change.actions、change.importing，其他欄位一律不碰。
 */
export interface Summary { lines: string[]; blocked: string[]; counts: Record<'import' | 'create' | 'update' | 'replace' | 'delete', number> }

/** 刪掉或取代就會失去資料、入口或歷史的資源：plan 出現這種動作就失敗，要做就在本機刻意做 */
export const PROTECTED: readonly RegExp[] = [
  /^cloudflare_d1_database$/, /^cloudflare_r2_bucket$/,
  /^cloudflare_zero_trust_access_(application|policy|identity_provider|service_token)$/,
  /^cloudflare_dns_record$/, /^cloudflare_ruleset$/, /^cloudflare_email_routing_/,
  /^github_repository_environment$/,
];

type Change = { address?: unknown; type?: unknown; change?: { actions?: unknown; importing?: unknown } };

export function summarize(plan: unknown): Summary {
  const out: Summary = { lines: [], blocked: [], counts: { import: 0, create: 0, update: 0, replace: 0, delete: 0 } };
  const changes = (plan as { resource_changes?: Change[] } | null)?.resource_changes;
  if (!Array.isArray(changes)) throw new Error('不是 tofu show -json 的 plan（沒有 resource_changes）');
  for (const c of changes) {
    const address = String(c.address ?? '');
    const type = String(c.type ?? '');
    const actions = Array.isArray(c.change?.actions) ? (c.change!.actions as unknown[]).map(String) : [];
    const importing = c.change?.importing != null;
    const del = actions.includes('delete');
    const create = actions.includes('create');
    let sym: string | null = null;
    if (del && create) { sym = '-/+'; out.counts.replace++; }
    else if (del) { sym = '-'; out.counts.delete++; }
    else if (create) { sym = '+'; out.counts.create++; }
    else if (actions.includes('update')) { sym = '~'; out.counts.update++; }
    if (importing) { out.counts.import++; sym = sym ? `<=import ${sym}` : '<=import'; }
    if (!sym) continue; // no-op 與 read（data source）不列
    out.lines.push(`${sym} ${address}`);
    if (del && PROTECTED.some((re) => re.test(type))) out.blocked.push(address);
  }
  return out;
}

export function render(s: Summary): string {
  const { import: i, create, update, replace, delete: d } = s.counts;
  const head = `import ${i}、新增 ${create}、修改 ${update}、取代 ${replace}、刪除 ${d}`;
  return [head, ...(s.lines.length ? s.lines : ['（沒有變更）'])].join('\n');
}
