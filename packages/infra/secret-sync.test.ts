import { describe, expect, it } from 'vitest';
import { check, fingerprint, sync, VAR_CONFLICT, type Api, type Values } from './secret-sync';

// 防的失敗：值寫錯 Worker、沒變的值也重寫（每次都產生新部署）、中途失敗後指紋不一致、或值出現在 log 裡
const CANARY = 'CANARY-secret';
const matrix = { 'w-admin': ['A', 'B'], 'w-cron': ['A'] };
const values = (): Values => ({ 'w-admin': { A: `${CANARY}-a`, B: `${CANARY}-b` }, 'w-cron': { A: `${CANARY}-a` } });

function fakeApi(remote: Record<string, string[] | null>, fail: Record<string, number> = {}) {
  const puts: string[] = [], placeholders: string[] = [];
  const api: Api = {
    list: async (w) => remote[w] ?? null,
    put: async (w, n, v) => { if (fail[`${w}/${n}`]) return { ok: false, code: fail[`${w}/${n}`], message: 'x' }; puts.push(`${w}/${n}=${v}`); return { ok: true }; },
    createPlaceholder: async (w, s) => { placeholders.push(`${w}:${Object.keys(s).sort().join(',')}`); return { ok: true }; },
  };
  return { api, puts, placeholders };
}
function memFp(initial: Record<string, string> = {}) {
  let saved = { ...initial };
  return { store: { load: async () => ({ ...saved }), save: async (f: Record<string, string>) => { saved = { ...f }; } }, get: () => saved };
}
const run = async (opts: Partial<Parameters<typeof sync>[0]> & { api: Api; fp: { load: () => Promise<Record<string, string>>; save: (f: Record<string, string>) => Promise<void> } }) => {
  const lines: string[] = [];
  const r = await sync({ matrix, values: values(), fpKey: 'k', log: (l) => lines.push(l), ...opts });
  return { ...r, lines };
};

describe('sync', () => {
  it('依對照表寫入：每個值只進它該去的 Worker', async () => {
    const { api, puts } = fakeApi({ 'w-admin': [], 'w-cron': [] });
    const r = await run({ api, fp: memFp().store });
    expect(r.ok).toBe(true);
    expect(puts.sort()).toEqual([`w-admin/A=${CANARY}-a`, `w-admin/B=${CANARY}-b`, `w-cron/A=${CANARY}-a`]);
  });
  it('指紋相同而且遠端有 → 不寫（避免每次 apply 都產生新部署）', async () => {
    const v = values();
    const fp = memFp({ 'w-admin/A': fingerprint('k', 'w-admin', 'A', v['w-admin']!.A!), 'w-admin/B': fingerprint('k', 'w-admin', 'B', v['w-admin']!.B!), 'w-cron/A': fingerprint('k', 'w-cron', 'A', v['w-cron']!.A!) });
    const { api, puts } = fakeApi({ 'w-admin': ['A', 'B'], 'w-cron': ['A'] });
    const r = await run({ api, fp: fp.store });
    expect(puts).toEqual([]);
    expect(r.lines.filter((l) => l.endsWith('unchanged'))).toHaveLength(3);
  });
  it('指紋相同但遠端被刪了 → 重建', async () => {
    const v = values();
    const fp = memFp({ 'w-cron/A': fingerprint('k', 'w-cron', 'A', v['w-cron']!.A!) });
    const { api, puts } = fakeApi({ 'w-admin': ['A', 'B'], 'w-cron': [] });
    await run({ api, fp: fp.store, only: 'w-cron' });
    expect(puts).toEqual([`w-cron/A=${CANARY}-a`]);
  });
  it('Worker 不存在 → 一次建空殼帶上全部 secret', async () => {
    const { api, puts, placeholders } = fakeApi({ 'w-admin': null, 'w-cron': [] });
    await run({ api, fp: memFp().store });
    expect(placeholders).toEqual(['w-admin:A,B']);
    expect(puts).toEqual([`w-cron/A=${CANARY}-a`]);
  });
  it('名稱已經是 var → 失敗並說明要先部署拿掉 var 的設定', async () => {
    const { api } = fakeApi({ 'w-admin': ['A'], 'w-cron': [] }, { 'w-admin/A': VAR_CONFLICT });
    const r = await run({ api, fp: memFp().store });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toMatch(/plain-text var/);
  });
  it('中途失敗：成功的那幾個已存指紋，失敗的沒有（再跑只補失敗的）', async () => {
    const fp = memFp();
    const { api } = fakeApi({ 'w-admin': [], 'w-cron': [] }, { 'w-admin/B': 500 });
    await run({ api, fp: fp.store });
    expect(Object.keys(fp.get()).sort()).toEqual(['w-admin/A', 'w-cron/A']);
  });
  it('遠端多出來的只警告，給刪除指令，自己不刪', async () => {
    const { api } = fakeApi({ 'w-admin': ['A', 'B', 'OLD'], 'w-cron': ['A'] });
    const r = await run({ api, fp: memFp().store });
    expect(r.lines.join('\n')).toContain('wrangler secret delete OLD --name w-admin');
  });
  it('對照表與值不一致 → 一個都不寫', async () => {
    const { api, puts } = fakeApi({ 'w-admin': [], 'w-cron': [] });
    const r = await sync({ matrix, values: { 'w-admin': { A: 'x' }, 'w-cron': { A: 'y' } }, api, fp: memFp().store, fpKey: 'k', log: () => {} });
    expect(r.ok).toBe(false);
    expect(puts).toEqual([]);
  });
  it('dry-run 不寫入', async () => {
    const { api, puts, placeholders } = fakeApi({ 'w-admin': null, 'w-cron': [] });
    await run({ api, fp: memFp().store, dryRun: true });
    expect([...puts, ...placeholders]).toEqual([]);
  });
  it('log 裡從不出現值', async () => {
    const { api } = fakeApi({ 'w-admin': ['A', 'X'], 'w-cron': null }, { 'w-admin/B': 500 });
    const r = await run({ api, fp: memFp().store });
    expect(r.lines.join('\n')).not.toContain(CANARY);
  });
});

it('check：只比名稱，缺的列出來並失敗', async () => {
  const lines: string[] = [];
  const r = await check(matrix, { list: async (w) => (w === 'w-admin' ? ['A'] : null) }, (l) => lines.push(l));
  expect(r.ok).toBe(false);
  expect(lines.join('\n')).toMatch(/w-admin 缺少 B/);
  expect(lines.join('\n')).toMatch(/w-cron 缺少 A（Worker 不存在）/);
});
