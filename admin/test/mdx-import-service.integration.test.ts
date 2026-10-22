import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lexicalToTree } from '../../packages/content-sync/lexical';
import { markupHtml } from '../../packages/content-sync/html';
import { importMdx, normalizePath, readZip, type InFile } from '../src/lib/mdx-import/service';
import { bootPayload } from './helpers/payload';

let t: Awaited<ReturnType<typeof bootPayload>>;
beforeAll(async () => { t = await bootPayload(); });
afterAll(async () => { await t?.close(); });

const enc = (s: string) => new TextEncoder().encode(s);
const FM = `---\ntitle: 導入測試\nslug: imp-test\ndate: 2026-05-01\nrealm: run\nexcerpt: 這是一段足夠長的摘要，通過下限檢查沒有問題，也方便辨認。\n---\n`;
const jpeg = (color: string) => sharp({ create: { width: 40, height: 30, channels: 3, background: color } }).jpeg().toBuffer();
const gpsJpeg = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#123' } }).withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 17/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '123/1 7/1 0/1' } }).jpeg().toBuffer();
const f = (path: string, data: Uint8Array | string): InFile => ({ path, data: typeof data === 'string' ? enc(data) : new Uint8Array(data) });
const mediaCount = async () => (await t.payload.count({ collection: 'media', overrideAccess: true })).totalDocs;
const get = (id: number | string) => t.payload.findByID({ collection: 'tales', id, draft: true, overrideAccess: true });

describe('導入 MDX', () => {
  it('完整的一篇：建立草稿、本機圖上傳、外站圖變待補圖、未知 JSX 保留並報錯', async () => {
    const before = await mediaCount();
    const r = await importMdx(t.payload, [
      f('post.mdx', `${FM}\n## 開頭\n\n文字 **粗**。\n\n![雪山](./pics/a.jpg)\n\n![外站](https://example.com/x.jpg)\n\n<Weird a="1" />\n`),
      f('pics/a.jpg', await jpeg('#789')),
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.missing).toEqual([]);
    expect(r.images).toEqual({ uploaded: 1, reused: 0 });
    expect(await mediaCount()).toBe(before + 1);
    const doc = await get(r.id);
    expect(doc).toMatchObject({ title: '導入測試', slug: 'imp-test', date: '2026-05-01', realm: 'run', _status: 'draft' });
    const tree = lexicalToTree(doc.content, 'x', { allowRaw: true });
    expect(tree.map((b) => b.t)).toEqual(['h', 'p', 'figure', 'missing', 'raw']);
    expect(r.problems.some((p) => p.level === 'error' && /Weird/.test(p.message))).toBe(true); // 沒有被吞掉
    // 沒處理的 JSX 會擋住發佈：渲染端的預設拒絕 raw
    expect(() => lexicalToTree(doc.content, 'x')).toThrow(/rawMdx/);
  });
  it('缺 frontmatter：照樣存成草稿，並列出缺哪些欄位（不猜）', async () => {
    const r = await importMdx(t.payload, [f('only/body.md', '只有內文\n')]);
    if ('error' in r) throw new Error(r.error);
    expect(r.missing.sort()).toEqual(['date', 'excerpt', 'realm', 'title']); // slug 由資料夾名補上
    expect((await get(r.id)).slug).toBe('only');
  });
  it('文章引用的圖沒有一起上傳：報錯並指出路徑，圖的位置留成待補圖（不是消失）', async () => {
    const r = await importMdx(t.payload, [f('p/index.mdx', `${FM.replace('imp-test', 'imp-miss')}\n![x](./nope.jpg)\n`)]);
    if ('error' in r) throw new Error(r.error);
    expect(r.problems.some((p) => p.level === 'error' && /nope\.jpg/.test(p.message))).toBe(true);
    expect(lexicalToTree((await get(r.id)).content, 'x').map((b) => b.t)).toEqual(['missing']);
  });
  it('同一張圖再導入一次：沿用既有媒體，不重複存', async () => {
    const buf = await jpeg('#abc');
    const a = await importMdx(t.payload, [f('a/index.mdx', `${FM.replace('imp-test', 'imp-dup1')}\n![x](./i.jpg)\n`), f('a/i.jpg', buf)]);
    const n1 = await mediaCount();
    const b = await importMdx(t.payload, [f('b/index.mdx', `${FM.replace('imp-test', 'imp-dup2')}\n![x](./i.jpg)\n`), f('b/i.jpg', buf)]);
    if ('error' in a || 'error' in b) throw new Error('導入失敗');
    expect(a.images.uploaded).toBe(1);
    expect(b.images).toEqual({ uploaded: 0, reused: 1 });
    expect(await mediaCount()).toBe(n1);
  });
  it('圖片帶 GPS：不匯入、明確報錯（隱私不能因為走匯入就繞過去）', async () => {
    const before = await mediaCount();
    const r = await importMdx(t.payload, [f('g/index.mdx', `${FM.replace('imp-test', 'imp-gps')}\n![x](./g.jpg)\n`), f('g/g.jpg', await gpsJpeg())]);
    if ('error' in r) throw new Error(r.error);
    expect(r.problems.some((p) => p.level === 'error' && /GPS/.test(p.message))).toBe(true);
    expect(await mediaCount()).toBe(before);
  });
  it('同名的圖有兩張（不同資料夾）：不猜，報找不到', async () => {
    const r = await importMdx(t.payload, [
      f('index.mdx', `${FM.replace('imp-test', 'imp-amb')}\n![x](x.jpg)\n`), f('one/x.jpg', await jpeg('#111')), f('two/x.jpg', await jpeg('#222')),
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.problems.some((p) => p.level === 'error')).toBe(true);
  });
  it('一次只能導入一篇；沒有 mdx 也會說明', async () => {
    expect(await importMdx(t.payload, [f('a.mdx', FM), f('b.mdx', FM)])).toMatchObject({ error: expect.stringContaining('一次只能導入一篇') });
    expect(await importMdx(t.payload, [f('a.jpg', await jpeg('#111'))])).toMatchObject({ error: expect.stringContaining('找不到') });
  });
  it('封面只寫在 frontmatter（cover 別名）、內文沒用到：照樣上傳並設為封面', async () => {
    const r = await importMdx(t.payload, [
      f('h/index.mdx', FM.replace('imp-test', 'imp-hero').replace(/---\n$/, 'cover: ./c.jpg\n---\n')), f('h/c.jpg', await jpeg('#456')),
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.problems).toEqual([]);
    expect(r.aliased).toEqual([{ from: 'cover', to: 'hero' }]);
    expect(r.images).toEqual({ uploaded: 1, reused: 0 });
    expect((await get(r.id)).hero).toBeTruthy();
  });
  it('frontmatter 引用的封面、路線找不到：報錯，不是默默存成空的', async () => {
    const r = await importMdx(t.payload, [f('n/index.mdx', `${FM.replace('imp-test', 'imp-noref').replace('---\n', '---\nhero: ./gone.jpg\nroute: no-such-route\n')}`)]);
    if ('error' in r) throw new Error(r.error);
    expect(r.problems.filter((p) => p.level === 'error').map((p) => p.message)).toEqual([
      expect.stringContaining('封面「./gone.jpg」找不到'), expect.stringContaining('路線「no-such-route」找不到'),
    ]);
  });
  it('網址代稱已被別篇用掉（例如同一篇導入第二次）：一開始就停下來，說是哪一篇，不上傳任何圖片、不建草稿', async () => {
    const first = await importMdx(t.payload, [f('d/index.mdx', FM.replace('imp-test', 'imp-again'))]);
    if ('error' in first) throw new Error(first.error);
    const before = await mediaCount();
    const tales = (await t.payload.count({ collection: 'tales', overrideAccess: true })).totalDocs;
    const again = await importMdx(t.payload, [f('d/index.mdx', `${FM.replace('imp-test', 'imp-again')}\n![x](./i.jpg)\n`), f('d/i.jpg', await jpeg('#13579b'))]);
    expect(again).toMatchObject({ error: expect.stringContaining('已經有一篇網址代稱是「imp-again」的文章（草稿「導入測試」）'), existing: first.id });
    expect(await mediaCount()).toBe(before);
    expect((await t.payload.count({ collection: 'tales', overrideAccess: true })).totalDocs).toBe(tales);
  });
  it('沒寫 slug、用資料夾名當代稱時也一樣先檢查', async () => {
    const one = await importMdx(t.payload, [f('same-folder/index.mdx', '只有內文\n')]);
    if ('error' in one) throw new Error(one.error);
    expect(await importMdx(t.payload, [f('same-folder/index.mdx', '只有內文\n')])).toMatchObject({ error: expect.stringContaining('「same-folder」'), existing: one.id });
  });
  it('MDX 語法錯誤：不丟例外，回報行號，仍建立（空內容的）草稿讓人修', async () => {
    const r = await importMdx(t.payload, [f('bad/index.mdx', `${FM.replace('imp-test', 'imp-bad')}\n<Open>\n`)]);
    if ('error' in r) throw new Error(r.error);
    expect(r.problems[0]).toMatchObject({ level: 'error', message: expect.stringContaining('解析失敗') });
  });
});

describe('路徑與 zip 的安全', () => {
  it.each([['./a/b.jpg', 'a/b.jpg'], ['a%20b.jpg', 'a b.jpg'], ['a\\b.jpg', 'a/b.jpg']])('正規化 %s → %s', (i, o) => expect(normalizePath(i)).toBe(o));
  it.each(['../x.jpg', 'a/../../x', '/etc/passwd', 'C:/x', '', 'a\0b'])('拒絕 %j', (p) => expect(normalizePath(p)).toBeNull());
  it('zip：正常解開，並略過 __MACOSX', () => {
    const z = zipSync({ 'post/index.mdx': enc('x'), 'post/a.jpg': new Uint8Array([1, 2]), '__MACOSX/post/._a.jpg': new Uint8Array([3]) });
    expect(readZip(z).map((x) => x.path).sort()).toEqual(['post/a.jpg', 'post/index.mdx']);
  });
  it('zip 路徑穿越 → 拒絕整個檔案', () => {
    expect(() => readZip(zipSync({ '../evil.mdx': enc('x') }))).toThrow(/不合法的路徑/);
  });
  it('zip 檔案太多 → 拒絕', () => {
    const many = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`f${i}.txt`, enc('x')]));
    expect(() => readZip(zipSync(many))).toThrow(/太多/);
  });
});

describe('zip 炸彈：用目錄裡宣告的大小擋，在解壓（配置記憶體）之前', () => {
  /** 把中央目錄裡每個項目宣告的「解壓後大小」改大（實際內容很小）：解壓前就該被擋下 */
  const forged = (n: number, declared: number) => {
    const z = zipSync(Object.fromEntries(Array.from({ length: n }, (_, i) => [`img${i}.jpg`, new Uint8Array(16)])));
    const dv = new DataView(z.buffer);
    for (let p = 0; p + 46 <= z.length; p++) if (dv.getUint32(p, true) === 0x02014b50) dv.setUint32(p + 24, declared, true);
    return z;
  };
  it('三個各宣告 50 MB 的項目（合計超過 80 MB 上限）→ 拒絕', () => {
    expect(() => readZip(forged(3, 50 * 1024 * 1024))).toThrow(/太大/);
  });
  it('檔案數超過上限 → 拒絕', () => {
    expect(() => readZip(zipSync(Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`f${i}.txt`, new Uint8Array(1)]))))).toThrow(/太多/);
  });
});

const article = path.resolve(import.meta.dirname, '../../src/content/tales/2026/grouse-grind-pole-experiment/index.mdx');
describe.skipIf(!existsSync(article))('整篇導入：Claude 寫的 Grouse Grind 稿（<style>、SVG 圖表、清單裡的表格、別名欄位）', () => {
  // 下載下來的那一份 frontmatter（沒有 realm、摘要寫成 description、多了作者與資料來源），內文與站上的同一篇
  const downloaded = [
    '---',
    'title: "十趟 Grouse Grind：一次關於登山杖的自體實驗，以及我如何推翻了自己一半的結論"',
    'description: "一天之內爬了十趟 Grouse Grind，單數趟徒手、雙數趟帶杖。統計結果乾淨得嚇人，但四個顯著指標全部來自同一個感測器——這篇文章講的是數據，也講的是怎麼不被數據騙。"',
    'date: "2026-08-17"', 'author: "Claude"', 'analyst: "Claude（Anthropic）"', 'dataSource: "Jacky · COROS + Strava"',
    'tags: ["訓練", "登山杖", "數據分析", "TOR450", "Grouse Grind", "越野跑"]', 'cover: ""', 'draft: true', '---', '',
  ].join('\n');
  it('內容沒有任何錯誤；只差行當要人選；存進去的正文建置得出來，圖表原樣在', async () => {
    const body = parseBody(readFileSync(article, 'utf8'));
    const r = await importMdx(t.payload, [f('grouse-grind-pole-experiment.mdx', downloaded + body)]);
    if ('error' in r) throw new Error(r.error);
    expect(r.problems.filter((p) => p.level === 'error')).toEqual([]);
    expect(r.missing).toEqual(['realm']);
    expect(r.issues).toEqual([]);
    expect(r.aliased).toEqual([{ from: 'description', to: 'excerpt' }]);
    expect(r.unknown.sort()).toEqual(['analyst', 'author', 'dataSource']);
    const doc = await get(r.id);
    expect(doc).toMatchObject({ slug: 'grouse-grind-pole-experiment', date: '2026-08-17', _status: 'draft', excerpt: expect.stringContaining('一天之內爬了十趟') });
    const tree = lexicalToTree(doc.content, 'grouse'); // 不丟錯：補上行當就能發佈
    const html = tree.flatMap((b) => (b.t === 'html' ? [markupHtml(b.nodes)] : [])).join('');
    expect(html).toContain('<style>');
    expect(html.match(/<path /g)).toHaveLength(10); // 十趟，十根柱子
    expect(html).toContain('<strong>帶杖組最差的一趟（42），仍然低於徒手組最好的一趟（76）。</strong>');
  });
});

/** 去掉站上那一份的 frontmatter，只留內文 */
function parseBody(src: string) { return src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''); }
