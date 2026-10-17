/**
 * M4：把 git 裡的內容（src/content、public/_redirects）搬進已部署的後台。
 *
 *   pnpm --dir admin migrate:push --target=staging              先演練：只列出會做什麼，不寫
 *   pnpm --dir admin migrate:push --target=staging --apply      寫進 staging
 *   pnpm --dir admin migrate:push --target=production --apply --yes-production
 *
 * 身分：用 cloudflared 取得「本人」的 Access JWT（cloudflared access login 過一次即可），
 * 後台照常驗 Access、照常要求 owner。沒有另外的憑證，也沒有給 CI 的寫入權限。
 * 冪等：重跑只補缺的；已存在的（同一張圖的 sha256、同一個 slug／videoId／轉址來源）一律略過，不覆蓋。
 * 帶 GPS 的圖片先在本機去掉位置資訊再上傳（後台會拒收帶 GPS 的圖）。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sniffImage } from '../src/lib/exif';
import { prepareImage } from '../src/lib/migration/prepare-image';
import { readGitCorpus } from '../src/lib/migration/git-corpus';

const ROOT = path.resolve(import.meta.dirname, '../..');
const HOSTS = { staging: 'admin-staging.jackywu.ca', production: 'admin.jackywu.ca' } as const;

const args = process.argv.slice(2);
const target = args.find((a) => a.startsWith('--target='))?.slice(9) as keyof typeof HOSTS | undefined;
const apply = args.includes('--apply');
if (!target || !(target in HOSTS)) { console.error('用法：migrate:push --target=staging|production [--apply] [--yes-production]'); process.exit(2); }
if (target === 'production' && apply && !args.includes('--yes-production')) { console.error('寫進正式後台要再加 --yes-production'); process.exit(2); }
const host = HOSTS[target];

const g = readGitCorpus(path.join(ROOT, 'src/content'));
const drafts = [...g.drafts];
const errors = g.problems.filter((p) => p.problem.level === 'error' && !g.drafts.has(p.file));
console.log(`語料：${g.corpus.tales.length} 篇文章（${drafts.length} 篇草稿）、${g.corpus.routes.length} 條路線、${g.corpus.reels.length} 支影片、${g.corpus.media.length} 張圖、${g.corpus.redirects.length} 條轉址`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e.file}：${e.problem.message}`);
  console.error('已上線的文章有轉換錯誤，不搬（先修 MDX，或跑 PARITY=1 的對照找原因）');
  process.exit(1);
}

async function prepare(file: string) {
  const p = await prepareImage(new Uint8Array(readFileSync(file)), file);
  return { ...p, name: path.basename(file) };
}

if (!apply) {
  let gps = 0;
  for (const m of g.corpus.media) if ((await prepare(g.mediaFiles.get(String(m.id))!)).stripped) gps++;
  console.log(`演練：${g.corpus.media.length} 張圖可以上傳（其中 ${gps} 張帶 GPS，上傳前會在本機去掉）。沒有寫入任何東西。加上 --apply 才會寫進 ${host}`);
  process.exit(0);
}

let token: string;
try {
  token = execFileSync('cloudflared', ['access', 'token', `-app=https://${host}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === 'ENOENT') console.error('找不到 cloudflared：先安裝（brew install cloudflared），再跑 cloudflared access login https://' + host);
  else console.error(`拿不到 Access 的登入：先跑一次 cloudflared access login https://${host}（會開瀏覽器，用 xudong.wu@gmail.com 收驗證碼）`);
  process.exit(2);
}
if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) { console.error(`cloudflared 回的不是 JWT：先跑 cloudflared access login https://${host}`); process.exit(2); }
const auth = { 'cf-access-token': token };

async function post(p: string, body: BodyInit, headers: Record<string, string> = {}) {
  const r = await fetch(`https://${host}/api${p}`, { method: 'POST', body, headers: { ...auth, ...headers }, redirect: 'manual' });
  if (r.status >= 300 && r.status < 400) throw new Error(`被導去登入頁（HTTP ${r.status}）：Access 的登入過期了，重跑 cloudflared access login https://${host}`);
  const text = await r.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch { throw new Error(`${p} 回了不是 JSON 的內容（HTTP ${r.status}）`); }
  return { status: r.status, body: json };
}

const mediaIds: Record<string, string | number> = {};
let n = 0, existed = 0, stripped = 0;
for (const m of g.corpus.media) {
  const file = g.mediaFiles.get(String(m.id))!;
  const p = await prepare(file);
  if (p.stripped) stripped++;
  const fd = new FormData();
  const type = sniffImage(p.data)!;
  fd.set('file', new File([new Uint8Array(p.data)], p.name, { type }));
  fd.set('alt', m.alt ?? '');
  fd.set('kind', 'img');
  fd.set('sha256', createHash('sha256').update(p.data).digest('hex'));
  const r = await post('/migrate/media', fd);
  if (r.status >= 300) { console.error(`✗ ${path.relative(ROOT, file)}：HTTP ${r.status} ${String(r.body.error ?? '')}`); process.exit(1); }
  mediaIds[String(m.id)] = r.body.id as string | number;
  if (r.body.existed) existed++;
  if (++n % 10 === 0) console.log(`  媒體 ${n}/${g.corpus.media.length}`);
}
console.log(`✓ 媒體 ${n} 張（${n - existed} 張新上傳、${existed} 張已存在、${stripped} 張去掉了 GPS）`);

const r = await post('/migrate/apply', JSON.stringify({ corpus: g.corpus, mediaIds, drafts }), { 'content-type': 'application/json' });
const created = r.body.created as Record<string, unknown> | undefined, skipped = r.body.skipped as Record<string, unknown> | undefined;
const count = (v: unknown) => (Array.isArray(v) ? v.length : Number(v ?? 0));
if (created && skipped) {
  console.log(`✓ 新建：文章 ${count(created.tales)}、路線 ${count(created.routes)}、影片 ${count(created.reels)}、轉址 ${count(created.redirects)}`);
  console.log(`  略過（已存在）：文章 ${count(skipped.tales)}、路線 ${count(skipped.routes)}、影片 ${count(skipped.reels)}、轉址 ${count(skipped.redirects)}`);
}
const errs = (r.body.errors as string[] | undefined) ?? [];
for (const e of errs) console.error(`✗ ${e}`);
if (r.status >= 300 && r.status !== 207) console.error(`✗ HTTP ${r.status} ${String(r.body.error ?? '')}`);
process.exit(errs.length || (r.status >= 300 && r.status !== 207) ? 1 : 0);
