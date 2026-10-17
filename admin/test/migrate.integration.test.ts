/**
 * M4 遷移的端點：/api/migrate/media 與 /api/migrate/apply（真的 Payload、空庫、miniflare 的 D1/R2）。
 *
 * 防的失敗：
 *  · 遷移後正文裡的圖、影片、路線指到錯的東西（本機 id 沒換成後台 id）
 *  · 草稿被當成已發佈上線，或已上線的文章變成草稿而從網站消失
 *  · 302 的轉址變成 301（瀏覽器與搜尋引擎會永久快取）
 *  · 重跑遷移把已存在的內容蓋掉、或建出重複的文件
 *  · 非本人呼叫得到寫入權限
 *
 * 另外，REHEARSAL=1 時用 git 裡的「全部」內容完整跑一次（比較慢）：
 *   REHEARSAL=1 pnpm --dir admin exec vitest run test/migrate.integration
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PayloadRequest } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { referencesOf } from '../../packages/content-sync/request';
import { migrateEndpoints } from '../src/endpoints/migrate';
import { mdxToLexical } from '../src/lib/mdx-import';
import { readGitCorpus } from '../src/lib/migration/git-corpus';
import { bootPayload } from './helpers/payload';

let t: Awaited<ReturnType<typeof bootPayload>>;
beforeAll(async () => { t = await bootPayload(); });
afterAll(async () => { await t?.close(); });

const owner = { id: 1, role: 'owner' };
const reader = { id: 2, role: 'reader' };
const handler = (p: string) => migrateEndpoints.find((e) => e.path === p)!.handler;
async function call(p: string, init: { body: BodyInit; headers?: Record<string, string>; user: unknown }) {
  const req = Object.assign(new Request('http://localhost/api' + p, { method: 'POST', body: init.body, headers: init.headers }), { payload: t.payload, user: init.user }) as unknown as PayloadRequest;
  const res = (await handler(p)(req)) as Response;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
async function upload(data: Uint8Array, name: string, alt: string, user: unknown = owner, sha = createHash('sha256').update(data).digest('hex')) {
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array(data)], name, { type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' }));
  fd.set('alt', alt); fd.set('kind', 'img'); fd.set('sha256', sha);
  return call('/migrate/media', { body: fd, user });
}
const png = async (color: string) => new Uint8Array(await (await import('sharp')).default({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer());

describe('/migrate/media', () => {
  it('只有本人能上傳', async () => {
    expect((await upload(await png('#fff'), 'a.png', 'a', reader)).status).toBe(401);
    expect((await upload(await png('#fff'), 'a.png', 'a', null)).status).toBe(401);
  });
  it('同一個檔案上傳兩次 → 同一個 id（重跑不會多出一張）', async () => {
    const data = await png('#123456');
    const a = await upload(data, 'same.png', '同一張');
    const b = await upload(data, 'same.png', '同一張');
    expect(a.status).toBe(201);
    expect(b.body).toMatchObject({ id: a.body.id, existed: true });
  });
  it('內容與 sha256 不符 → 拒收（傳輸中損壞）', async () => {
    const r = await upload(await png('#654321'), 'x.png', 'x', owner, '0'.repeat(64));
    expect(r.status).toBe(422);
  });
});

describe('/migrate/apply', () => {
  it('寫入、換 id、草稿維持草稿、302 保留；重跑全部略過', async () => {
    const hero = await upload(await png('#aa0000'), 'hero.png', '封面');
    const inner = await upload(await png('#00aa00'), 'inner.png', '正文的圖');
    const poster = await upload(await png('#0000aa'), 'poster.png', '影片封面');
    // 語料裡的本機 id：媒體 1、2、3；影片 7；路線 9
    const content = mdxToLexical('第一段。\n\n![正文的圖](./inner.png)\n\n<Video entry="2026/test-reel" />\n\n<Route of="test-route" />\n', {
      resolveImage: () => 2, resolveReel: () => 7, resolveRoute: () => 9,
    });
    expect(content.problems.filter((p) => p.level === 'error')).toEqual([]);
    const excerpt = '在雪山上走了一整天，風很大，人很少，回來之後什麼都記得。';
    const corpus = {
      tales: [
        { id: 1, title: '已上線的一篇', slug: 'live-one', date: '2026-01-15', realm: 'snow', excerpt, hero: 1, heroAlt: '封面', video: 7, route: 9, shareable: true, content: content.state },
        { id: 2, title: '還沒寫完的一篇', slug: 'draft-one', date: '2026-01-16', realm: 'snow', excerpt, shareable: true, content: null, legacy: null },
      ],
      pages: [],
      reels: [{ id: 7, title: '測試影片', videoId: 'test-reel', poster: 3, posterAlt: '影片封面', duration: 10, bytes: 1000, ratio: '16/9', realm: 'snow', date: '2026-01-15', caption: null }],
      routes: [{ id: 9, slug: 'test-route', name: '測試路線', realm: 'run', date: '2026-01-15', region: '溫哥華', distanceKm: 12.3, gainM: 456, downloadable: true, svgTrack: '<svg/>', svgThumb: '<svg/>', svgProfile: '<svg/>' }],
      media: [],
      redirects: [{ from: '/old-a', to: '/tales/2026/live-one/', status: '301' }, { from: '/old-b', to: '/run/', status: '302' }],
    };
    const input = { corpus, mediaIds: { 1: hero.body.id, 2: inner.body.id, 3: poster.body.id }, drafts: ['2026/draft-one'] };

    expect((await call('/migrate/apply', { body: JSON.stringify(input), user: reader })).status).toBe(401);
    const r1 = await call('/migrate/apply', { body: JSON.stringify(input), user: owner });
    expect(r1.body.errors).toEqual([]);
    expect(r1.status).toBe(200);
    expect(r1.body.created).toEqual({ reels: ['test-reel'], routes: ['test-route'], tales: ['2026/live-one', '2026/draft-one'], redirects: 2 });

    const find = async (collection: 'tales' | 'reels' | 'routes' | 'redirects', where: Record<string, unknown>) =>
      (await t.payload.find({ collection, where: where as never, draft: true, depth: 0, overrideAccess: true, limit: 1 })).docs[0] as unknown as Record<string, unknown>;
    const live = await find('tales', { slug: { equals: 'live-one' } });
    const reel = await find('reels', { videoId: { equals: 'test-reel' } });
    const route = await find('routes', { slug: { equals: 'test-route' } });
    expect(live._status).toBe('published');
    expect((await find('tales', { slug: { equals: 'draft-one' } }))._status).toBe('draft');
    // 每一個引用都換成後台的 id
    const refs = referencesOf('tales', live);
    expect([...refs.media].sort()).toEqual([String(hero.body.id), String(inner.body.id)].sort());
    expect([...refs.reels]).toEqual([String(reel.id)]);
    expect([...refs.routes]).toEqual([String(route.id)]);
    expect(String(reel.poster)).toBe(String(poster.body.id));
    expect((reel.transcode as { status: string }).status).toBe('done');
    expect(route.svgTrack).toBe('<svg/>');
    expect((await find('redirects', { from: { equals: '/old-b' } })).status).toBe('302');

    // 重跑：一個都不建
    const before = (await t.payload.count({ collection: 'tales', overrideAccess: true })).totalDocs;
    const r2 = await call('/migrate/apply', { body: JSON.stringify(input), user: owner });
    expect(r2.body.created).toEqual({ reels: [], routes: [], tales: [], redirects: 0 });
    expect(r2.body.skipped).toMatchObject({ reels: ['test-reel'], routes: ['test-route'], redirects: 2 });
    expect((await t.payload.count({ collection: 'tales', overrideAccess: true })).totalDocs).toBe(before);
  });

  it('引用了沒上傳的媒體 → 那一篇不建，錯誤說明是哪一篇、哪個 id；其他照常', async () => {
    const corpus = {
      tales: [{ id: 1, title: '缺圖的一篇', slug: 'missing-media', date: '2026-02-01', realm: 'run', excerpt: '在雪山上走了一整天，風很大，人很少，回來之後什麼都記得。', hero: 99, heroAlt: 'x', shareable: true, content: null }],
      pages: [], reels: [], routes: [], media: [], redirects: [],
    };
    const r = await call('/migrate/apply', { body: JSON.stringify({ corpus, mediaIds: {}, drafts: [] }), user: owner });
    expect(r.status).toBe(207);
    expect((r.body.errors as string[]).join()).toMatch(/2026\/missing-media.*media 99/);
    expect((await t.payload.find({ collection: 'tales', where: { slug: { equals: 'missing-media' } }, draft: true, overrideAccess: true })).totalDocs).toBe(0);
  });
});

// 完整演練：git 裡的全部內容。媒體直接用 Local API 寫（端點的行為上面已經測過），重點是每一篇都過得了發佈的驗證
const ROOT = path.resolve(import.meta.dirname, '../..');
describe.skipIf(process.env.REHEARSAL !== '1' || !existsSync(path.join(ROOT, 'src/content/tales')))('完整演練（git 的全部內容）', () => {
  it('每一篇都寫得進去，沒有錯誤', async () => {
    const g = readGitCorpus(path.join(ROOT, 'src/content'));
    const mediaIds: Record<string, string | number> = {};
    for (const m of g.corpus.media) {
      const file = g.mediaFiles.get(String(m.id))!;
      const data = new Uint8Array(readFileSync(file));
      const r = await upload(data, path.basename(file), m.alt ?? '');
      expect(r.status, `${file}：${JSON.stringify(r.body)}`).toBeLessThan(300);
      mediaIds[String(m.id)] = r.body.id as string | number;
    }
    const drafts = [...g.drafts];
    const r = await call('/migrate/apply', { body: JSON.stringify({ corpus: g.corpus, mediaIds, drafts }), user: owner });
    expect(r.body.errors).toEqual([]);
    expect((r.body.created as { tales: string[] }).tales).toHaveLength(g.corpus.tales.length);

    // Payload 存的正文必須和語料（換過 id）逐字相同：存檔時被任何 hook 改過，建置出來就和 git 模式不一樣
    const ids = async (c: 'reels' | 'routes', key: string, local: { id: string | number }[], nat: (x: never) => string) => {
      const m = new Map<string, string | number>();
      for (const x of local) {
        const d = (await t.payload.find({ collection: c, where: { [key]: { equals: nat(x as never) } }, depth: 0, draft: true, overrideAccess: true, limit: 1 })).docs[0]!;
        m.set(String(x.id), d.id);
      }
      return m;
    };
    const map = {
      media: new Map(Object.entries(mediaIds)),
      reels: await ids('reels', 'videoId', g.corpus.reels, (x: { videoId: string }) => x.videoId),
      routes: await ids('routes', 'slug', g.corpus.routes, (x: { slug: string }) => x.slug),
    };
    const { remapRefs } = await import('../../packages/content-sync/request');
    for (const tale of g.corpus.tales) {
      const stored = (await t.payload.find({ collection: 'tales', where: { slug: { equals: tale.slug } }, depth: 0, draft: true, overrideAccess: true, limit: 1 })).docs[0]!;
      const want = remapRefs('tales', tale as never, map).content;
      expect(JSON.stringify(stored.content), tale.slug).toBe(JSON.stringify(want));
    }
  }, 600_000);
});
