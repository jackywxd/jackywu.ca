/**
 * 遷移第一階段：清點。
 *
 * 只讀不寫舊 repo。產出兩個檔：
 *   migration/content-manifest.json  —— 機器讀的完整事實
 *   migration-decisions.yaml         —— 你填的三欄（action / realm / excerpt）
 *
 * 這支腳本不做任何編輯判斷。哪篇留、怎麼翻譯、歸哪個行當，都是你的決定。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import YAML from 'yaml';

const OLD = process.env.OLD_SITE ?? '/Users/jackywxd/repos/jackywu.ca';
const BLOG = join(OLD, 'data/blog');
const OUT_DIR = 'migration';
const MANIFEST = join(OUT_DIR, 'content-manifest.json');
const DECISIONS = 'migration-decisions.yaml';
const LIVE = process.env.LIVE_ORIGIN ?? 'https://www.jackywu.ca';
const skipProbe = process.argv.includes('--offline');

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/^index\.mdx?$/.test(e)) out.push(p);
  }
  return out;
};

const splitFrontmatter = (text) => {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { raw: {}, body: text };
  let raw = {};
  try { raw = YAML.parse(m[1]) ?? {}; } catch (e) { raw = { __parseError: String(e.message) }; }
  return { raw, body: m[2] };
};

/** 舊站的 URL 規則：contentlayer 的 flattenedPath 去掉開頭的 blog/ */
const oldUrlOf = (file) => {
  const rel = relative(BLOG, dirname(file));               // 例：2020/2020-08-03 Castle Tower
  return '/blog/' + rel.split('/').map(encodeURIComponent).join('/');
};

/** 從資料夾名撈日期，用來比對 frontmatter 的日期對不對 */
const folderDate = (file) => basename(dirname(file)).match(/(\d{4})-(\d{2})-(\d{2})/)?.[0] ?? null;

const TOPIC = [
  [/marathon|trail run|\brun\b|running|ultra/i, 'run'],
  [/\bski|snow|powder/i, 'snow'],
  [/moto|motorcycle|ride/i, 'road'],
  [/hike|mountain|glacier|summit|climb/i, 'wild'],
  [/aws|vpn|firebase|typescript|javascript|node|docker|systemd|ocserv|apple|receipt|twilio|dns|pi-?zero|raspberry/i, 'forge'],
];
const detectRealm = (raw, body, file) => {
  const hay = [raw.title, raw.category, raw.template, (raw.tags ?? []).join(' '), file].join(' ');
  for (const [re, realm] of TOPIC) if (re.test(hay)) return realm;
  return /memory|wife|passed away/i.test(hay + body.slice(0, 400)) ? 'still' : 'forge';
};

const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);

const files = walk(BLOG).sort();
const posts = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const { raw, body } = splitFrontmatter(text);
  const rel = relative(OLD, file);
  const ext = file.endsWith('.md') ? 'md' : 'mdx';

  const imgs = [
    ...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g),
    ...body.matchAll(/<(?:img|Image)[^>]*\ssrc=["']([^"']+)/g),
  ].map((m) => m[1]);

  const fd = folderDate(file);
  const fmDate = raw.date ? String(raw.date).slice(0, 10) : null;

  posts.push({
    file: rel,
    ext,
    // 舊站只把 .mdx 納入建置，3 個 .md 從來沒上線過
    builtByOldSite: ext === 'mdx',
    oldUrl: oldUrlOf(file),
    liveStatus: null,
    raw,
    title: raw.title ?? null,
    date: fmDate,
    folderDate: fd,
    dateMismatch: !!(fd && fmDate && fd !== fmDate),
    draft: raw.draft === true,
    chars: body.length,
    hasCJK: /[一-鿿]/.test(body),
    localImages: imgs.filter((u) => !/^https?:/.test(u)),
    remoteImages: imgs.filter((u) => /^https?:/.test(u)),
    attachments: raw.attachments ?? [],
    detectedRealm: detectRealm(raw, body, rel),
    oldSlug: raw.slug ?? null,
    proposedSlug: slugify(raw.slug ?? raw.title ?? basename(dirname(file))),
  });
}

// slug 撞號：舊站沒用 slug 欄位所以沒爆（三篇共用 pi-vpn-wifi-ap-and-vpn-gateway），
// 新站照用就會三篇寫進同一個目錄互相覆蓋。撞號時改用標題衍生，仍撞就加年份。
{
  const count = new Map();
  for (const p of posts) count.set(p.proposedSlug, (count.get(p.proposedSlug) ?? 0) + 1);
  const taken = new Set();
  for (const p of posts) {
    p.slugCollision = (count.get(p.proposedSlug) ?? 0) > 1;
    if (p.slugCollision) p.proposedSlug = slugify(p.title ?? p.proposedSlug);
    let s = p.proposedSlug, i = 0;
    while (taken.has(s)) s = `${p.proposedSlug}-${(p.date ?? p.folderDate ?? '').slice(0, 4) || ++i}`;
    p.proposedSlug = s;
    taken.add(s);
  }
}

// 實測線上狀態 —— 不能靠猜。轉址表只該收真的還活著的 URL。
if (!skipProbe) {
  process.stdout.write('探測線上狀態 ');
  for (const p of posts) {
    try {
      const r = await fetch(LIVE + p.oldUrl, { method: 'HEAD', redirect: 'follow' });
      p.liveStatus = r.status;
    } catch { p.liveStatus = 0; }
    process.stdout.write(p.liveStatus === 200 ? '.' : '×');
  }
  console.log('');
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), source: OLD, live: LIVE, posts }, null, 2));

// ── 決策骨架。已存在就保留你填過的內容，只補新條目 ──
let existing = {};
if (existsSync(DECISIONS)) {
  for (const d of YAML.parse(readFileSync(DECISIONS, 'utf8')) ?? []) existing[d.old] = d;
}
const decisions = posts.map((p) => {
  const prev = existing[p.file] ?? {};
  return {
    old: p.file,
    // ── 以下是事實，由腳本填，不要改 ──
    _title: p.title,
    _date: p.date,
    _live: p.liveStatus,
    _chars: p.chars,
    _localImages: p.localImages.length,
    _remoteImages: p.remoteImages.length,
    _flags: [
      !p.builtByOldSite && '舊站未建置(.md)',
      p.draft && 'draft',
      p.dateMismatch && `日期不符(資料夾=${p.folderDate})`,
      p.slugCollision && 'slug撞號',
      p.detectedRealm === 'still' && '⚠ 私人文，不自動處理',
    ].filter(Boolean),
    // ── 以下請你填 ──
    action: prev.action ?? (p.detectedRealm === 'still' ? 'HOLD' : 'keep'),  // keep | archive | retire | HOLD
    realm: prev.realm ?? p.detectedRealm,
    // 日期不符時預填資料夾日期（資料夾名通常才是實際日期），但請你覆核 ——
    // 只有廣州馬與香港馬那兩篇是明確的匯入錯誤，另外兩篇是判斷題。
    date: prev.date ?? (p.dateMismatch ? p.folderDate : p.date),
    slug: prev.slug ?? p.proposedSlug,
    lang: prev.lang ?? (p.hasCJK ? 'zh-Hant' : 'en'),
    excerpt: prev.excerpt ?? '',
  };
});
writeFileSync(DECISIONS, YAML.stringify(decisions, { lineWidth: 0 }));

// ── 報告 ──
const n = (f) => posts.filter(f).length;
console.log(`\n清點 ${posts.length} 篇（${OLD}）`);
console.log(`  舊站實際建置        ${n((p) => p.builtByOldSite)}（${n((p) => !p.builtByOldSite)} 篇 .md 從未上線）`);
if (!skipProbe) console.log(`  線上回 200          ${n((p) => p.liveStatus === 200)}`);
console.log(`  標了 draft          ${n((p) => p.draft)}${n((p) => p.draft && p.liveStatus === 200) ? `（其中 ${n((p) => p.draft && p.liveStatus === 200)} 篇線上仍回 200）` : ''}`);
console.log(`  日期與資料夾不符    ${n((p) => p.dateMismatch)}`);
console.log(`  slug 撞號           ${n((p) => p.slugCollision)}`);
console.log(`  本地圖引用          ${posts.reduce((a, p) => a + p.localImages.length, 0)}`);
console.log(`  遠端熱鏈            ${posts.reduce((a, p) => a + p.remoteImages.length, 0)}`);
console.log(`  含中文              ${n((p) => p.hasCJK)}`);
console.log('\n行當分佈');
for (const [r, c] of Object.entries(posts.reduce((m, p) => ({ ...m, [p.detectedRealm]: (m[p.detectedRealm] ?? 0) + 1 }), {})))
  console.log(`  ${r.padEnd(8)} ${c}`);
console.log(`\n寫入 ${MANIFEST}`);
console.log(`寫入 ${DECISIONS} —— 請填 action / realm / slug / excerpt 四欄`);
