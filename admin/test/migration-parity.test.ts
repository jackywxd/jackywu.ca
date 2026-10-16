/**
 * M4 遷移對照（慢，需要 git 裡的現有內容）：
 *   PARITY=1 pnpm --dir admin exec vitest run test/migration-parity
 *
 * 把 git 裡的 29 篇文章等內容轉成 Payload 語料，分別以 git 模式與 payload 模式建置，
 * 比對兩份產物：頁面集合、每頁文字、圖片數量與 alt、RSS、sitemap、轉址。
 * 有差異就逐條列出——切換前必須是零差異，或每一條差異都有說明。
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFiles } from '../../packages/content-sync/files';
import { readGitCorpus } from '../src/lib/migration/git-corpus';

const ROOT = path.resolve(import.meta.dirname, '../..');
const run = process.env.PARITY === '1' && existsSync(path.join(ROOT, 'src/content/tales'));
const OUT_GIT = '/tmp/parity-dist-git';
const OUT_PAYLOAD = '/tmp/parity-dist-payload';
const PAYLOAD_DIR = path.join(ROOT, 'src/content/payload');

const walk = (d: string, out: string[] = []) => {
  for (const e of readdirSync(d).sort()) { const p = path.join(d, e); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
};
/** vitest 會把 MODE=test、DEV=1、NODE_PATH（指向 admin 的 node_modules）等放進環境；
 *  原樣傳給前台的建置，import.meta.env.PROD 會變 false（草稿被建出來），模組解析也會被帶偏。 */
const cleanEnv = (extra: Record<string, string>) => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (/^(VITEST|VITE_|TEST$|MODE$|DEV$|PROD$|SSR$|NODE_PATH$)/.test(k)) delete env[k];
  return { ...env, NODE_ENV: 'production', ...extra } as NodeJS.ProcessEnv;
};
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: cleanEnv(env), maxBuffer: 1 << 28 });

const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ');
function summarize(file: string) {
  const html = readFileSync(file, 'utf8');
  const main = html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? html;
  const text = decode(main.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const imgs = [...main.matchAll(/<img\b[^>]*>/g)].map((m) => m[0].match(/\balt="([^"]*)"/)?.[1] ?? '');
  return { text, imgs };
}

describe.skipIf(!run)('git → Payload 遷移對照', () => {
  it('轉換、兩種模式各建置一次、逐頁比對', () => {
    const g = readGitCorpus(path.join(ROOT, 'src/content'));
    expect(g.corpus.tales).toHaveLength(29);

    // 轉換問題：只允許一篇草稿（含 <style>／<figure> 圖表）有錯誤
    const errs = g.problems.filter((p) => p.problem.level === 'error');
    expect([...new Set(errs.map((e) => e.file))]).toEqual(['2026/grouse-grind-pole-experiment']);

    // 草稿不上線：從要建置的語料拿掉
    const published = { ...g.corpus, tales: g.corpus.tales.filter((t) => !g.drafts.has(`${t.date.slice(0, 4)}/${t.slug}`)) };
    const built = buildFiles(published);

    if (existsSync(PAYLOAD_DIR)) {
      expect(existsSync(path.join(PAYLOAD_DIR, '.generated-by-fetch-content')), 'src/content/payload 不是產生的，拒絕覆蓋').toBe(true);
      rmSync(PAYLOAD_DIR, { recursive: true });
    }
    mkdirSync(PAYLOAD_DIR, { recursive: true });
    writeFileSync(path.join(PAYLOAD_DIR, '.generated-by-fetch-content'), 'generated\n');
    for (const [rel, f] of built.files) {
      const dest = path.join(PAYLOAD_DIR, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      if ('text' in f) writeFileSync(dest, f.text); else copyFileSync(g.mediaFiles.get(f.media)!, dest);
    }

    for (const d of [OUT_GIT, OUT_PAYLOAD]) rmSync(d, { recursive: true, force: true });
    // 字型：git 模式與 payload 模式各自子集化（掃的是各自的內容）
    let r = sh('node', ['scripts/build-fonts.mjs']);
    expect(r.status, r.stderr).toBe(0);
    r = sh('pnpm', ['exec', 'astro', 'build', '--outDir', OUT_GIT]);
    expect(r.status, (r.stdout + r.stderr).slice(-2000)).toBe(0);

    r = sh('node', ['scripts/build-fonts.mjs'], { CONTENT_SOURCE: 'payload' });
    expect(r.status, r.stderr).toBe(0);
    r = sh('pnpm', ['exec', 'astro', 'build', '--outDir', OUT_PAYLOAD], { CONTENT_SOURCE: 'payload' });
    expect(r.status, (r.stdout + r.stderr).slice(-2000)).toBe(0);

    const pages = (d: string) => walk(d).filter((f) => f.endsWith('.html')).map((f) => path.relative(d, f));
    const a = pages(OUT_GIT), b = pages(OUT_PAYLOAD);
    const diffs: string[] = [];
    for (const p of a.filter((x) => !b.includes(x))) diffs.push(`只有 git 有：${p}`);
    for (const p of b.filter((x) => !a.includes(x))) diffs.push(`只有 payload 有：${p}`);
    for (const p of a.filter((x) => b.includes(x))) {
      const x = summarize(path.join(OUT_GIT, p)), y = summarize(path.join(OUT_PAYLOAD, p));
      if (x.text !== y.text) {
        let i = 0; while (i < x.text.length && x.text[i] === y.text[i]) i++;
        diffs.push(`${p} 文字不同，第 ${i} 字起：git「${x.text.slice(Math.max(0, i - 10), i + 30)}」 vs payload「${y.text.slice(Math.max(0, i - 10), i + 30)}」`);
      }
      if (JSON.stringify(x.imgs) !== JSON.stringify(y.imgs)) diffs.push(`${p} 圖片不同：git ${x.imgs.length} 張、payload ${y.imgs.length} 張`);
    }
    for (const f of ['rss.xml', 'sitemap-0.xml']) {
      const x = existsSync(path.join(OUT_GIT, f)) ? readFileSync(path.join(OUT_GIT, f), 'utf8') : '';
      const y = existsSync(path.join(OUT_PAYLOAD, f)) ? readFileSync(path.join(OUT_PAYLOAD, f), 'utf8') : '';
      const links = (s: string) => [...s.matchAll(/<(?:link|loc)>([^<]+)</g)].map((m) => m[1]).sort();
      if (JSON.stringify(links(x)) !== JSON.stringify(links(y))) diffs.push(`${f} 的連結集合不同`);
    }
    // 轉址：語料裡的轉址（來自 public/_redirects）必須完整保留
    const gitRedirects = readFileSync(path.join(ROOT, 'public/_redirects'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/).slice(0, 2).join(' '));
    const payloadRedirects = JSON.parse(readFileSync(path.join(PAYLOAD_DIR, 'redirects.json'), 'utf8')).map((r: { from: string; to: string }) => `${r.from} ${r.to}`);
    for (const x of gitRedirects) if (!payloadRedirects.includes(x)) diffs.push(`轉址遺失：${x}`);

    writeFileSync('/tmp/parity-report.txt', diffs.join('\n') + '\n');
    expect(diffs, `差異清單已寫到 /tmp/parity-report.txt\n${diffs.slice(0, 20).join('\n')}`).toEqual([]);
  }, 600_000);
});
