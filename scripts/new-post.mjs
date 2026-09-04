/**
 * 開一篇新文章。
 *
 *   pnpm new "雪季第一天" --realm snow
 *   pnpm new "威士拿 100K 賽記" --realm run --date 2026-08-22 ~/Photos/a.jpg ~/Photos/b.jpg
 *
 * 建資料夾、寫好 frontmatter、把你丟進來的圖一起複製進去，
 * 並印出 dev 網址。剩下的就是寫字。
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const REALMS = { run: '追雲', snow: '逐雪', road: '鐵馬', wild: '探幽', forge: '爐火', still: '靜' };
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i === -1 ? d : args[i + 1]; };

const title = args.find((a) => !a.startsWith('--') && !existsSync(a) && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
if (!title) {
  console.error(`用法: pnpm new "標題" --realm <${Object.keys(REALMS).join('|')}> [--date YYYY-MM-DD] [--slug my-slug] [圖片...]`);
  process.exit(1);
}

const realm = flag('realm', 'run');
if (!REALMS[realm]) { console.error(`realm 要是 ${Object.keys(REALMS).join(' / ')} 之一`); process.exit(1); }

const date = flag('date', new Date().toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error('date 格式要是 YYYY-MM-DD'); process.exit(1); }

/** 中文標題沒有好的自動 slug —— 落回日期，讓你自己改 */
const autoSlug = title
  .toLowerCase().normalize('NFKD')
  .replace(/[^\w\s-]/g, '').trim()
  .replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 50);
const slug = flag('slug', autoSlug);
// 純中文標題推導不出 slug。與其偷偷產生 post-2026-12-14 這種爛網址，
// 不如直接要求指定 —— 網址是要被分享出去的東西。
if (!slug) {
  console.error(`標題「${title}」推導不出網址 slug（中文標題會這樣）。`);
  console.error(`加 --slug 指定，例如：--slug first-day-of-season`);
  process.exit(1);
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error(`slug「${slug}」不合法。用 --slug 指定小寫英數與連字號，不要空白或中文。`);
  process.exit(1);
}

const dir = join('src/content/tales', slug);
if (existsSync(dir)) { console.error(`${dir} 已經存在`); process.exit(1); }

// 位置參數裡真的存在的檔案 = 要一起複製的圖
const images = args.filter((a) => !a.startsWith('--') && existsSync(a) && statSync(a).isFile());
mkdirSync(dir, { recursive: true });
const copied = images.map((src) => {
  const name = basename(src).replace(/[^\w.-]/g, '_').toLowerCase();
  copyFileSync(src, join(dir, name));
  return name;
});

const hero = copied[0];
const rest = copied.slice(1);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const fm = [
  '---',
  `title: ${q(title)}`,
  `date: ${date}`,
  `realm: ${realm}`,
  "lang: 'zh-Hant'",
  "excerpt: ''            # 必填，20–120 字。給機器讀：meta / RSS / 卡片",
  "verse: ''              # ≤40 字。海報上那行大字。不填就退回 excerpt",
  "tags: []",
  hero ? `hero: ./${hero}` : "# hero: ./cover.jpg",
  hero ? "heroAlt: ''            # 有 hero 就必填" : "# heroAlt: ''",
  'draft: true            # 寫完拿掉',
  '---',
].join('\n');

const body = [
  '',
  ...(rest.length ? [
    "import Figure from '@/components/media/Figure.astro';",
    ...rest.map((f, i) => `import img${i + 1} from './${f}';`),
    '',
  ] : []),
  '正文從這裡開始。',
  '',
  ...(rest.length ? [
    `<Figure src={img1} alt="" caption="" />`,
    '',
  ] : []),
].join('\n');

writeFileSync(join(dir, 'index.mdx'), `${fm}\n${body}`);

console.log(`\n開好了：${dir}/index.mdx`);
console.log(`  行當   ${realm}（${REALMS[realm]}）`);
console.log(`  日期   ${date}`);
if (copied.length) console.log(`  圖片   ${copied.length} 張已複製${hero ? `（${hero} 設為題圖）` : ''}`);
console.log(`\n還要填：excerpt（必填）${hero ? '、heroAlt（必填）' : ''}`);
console.log(`寫完把 draft: true 拿掉。\n`);
console.log(`  pnpm dev`);
console.log(`  → http://localhost:4321/tales/${slug}/\n`);
