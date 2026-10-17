import { describe, expect, it } from 'vitest';
import type { Corpus } from './files';
import { applyRequest, missingDeps } from './request';

const base = (): Corpus => ({
  tales: [{ id: 1, title: 'a', slug: 'a', date: '2026-01-01', realm: 'run', excerpt: 'x' }],
  pages: [], routes: [], reels: [], media: [], redirects: [],
});
const blk = (fields: Record<string, unknown>) => ({ type: 'block', fields });
const body = (...c: unknown[]) => ({ root: { type: 'root', children: c } });

describe('applyRequest', () => {
  it('發佈新文章：加進去，其他文章原樣', () => {
    const c = applyRequest(base(), { kind: 'publish', collection: 'tales', docId: '2' }, { id: 2, title: 'b', slug: 'b' });
    expect(c.tales.map((t) => t.id)).toEqual([1, 2]);
  });
  it('發佈已存在的文章：換成新版本，不會出現兩份', () => {
    const c = applyRequest(base(), { kind: 'publish', collection: 'tales', docId: '1' }, { id: 1, title: 'a2', slug: 'a' });
    expect(c.tales).toHaveLength(1);
    expect(c.tales[0]!.title).toBe('a2');
  });
  it('id 的型別不同（數字 vs 字串）也認得是同一篇', () => {
    const c = applyRequest(base(), { kind: 'publish', collection: 'tales', docId: '1' }, { id: '1', title: 'z', slug: 'a' });
    expect(c.tales).toHaveLength(1);
  });
  it('撤下：從語料移除；本來就不在 → 報錯', () => {
    expect(applyRequest(base(), { kind: 'unpublish', collection: 'tales', docId: '1' }).tales).toEqual([]);
    expect(() => applyRequest(base(), { kind: 'unpublish', collection: 'tales', docId: '9' })).toThrow(/本來就不在/);
  });
  it('不改動輸入（純函式）', () => {
    const c = base();
    applyRequest(c, { kind: 'unpublish', collection: 'tales', docId: '1' });
    expect(c.tales).toHaveLength(1);
  });
  it('版本與請求對不上 → 報錯', () => {
    expect(() => applyRequest(base(), { kind: 'publish', collection: 'tales', docId: '1' }, { id: 2 })).toThrow(/版本屬於/);
    expect(() => applyRequest(base(), { kind: 'publish', collection: 'tales', docId: '1' })).toThrow(/必須帶版本/);
  });
});

describe('missingDeps（依賴閉包）', () => {
  it('文章引用的 hero、影片、路線、正文圖，缺的都列出來', () => {
    const c = base();
    c.tales[0] = { ...c.tales[0]!, hero: 5, video: 6, route: 7, content: body(blk({ blockType: 'figure', media: 8 }), blk({ blockType: 'route', route: 9 })) };
    expect(missingDeps(c)).toEqual({ media: ['5', '8'], routes: ['7', '9'], reels: ['6'] });
  });
  it('已經在語料裡的不列', () => {
    const c = base();
    c.tales[0] = { ...c.tales[0]!, hero: { id: 5 } };
    c.media = [{ id: 5, filename: 'a.jpg' }];
    expect(missingDeps(c).media).toEqual([]);
  });
  it('依賴的依賴：路線引用的封面、影片引用的 poster 也要補', () => {
    const c = base();
    c.reels = [{ id: 6, title: 'v', videoId: 'v', poster: 20, posterAlt: '', realm: 'run', date: '2026-01-01' }];
    c.routes = [{ id: 7, slug: 'r', name: 'r', realm: 'run', date: '2026-01-01', region: 'x', cover: 21 }];
    expect(missingDeps(c).media).toEqual(['20', '21']);
  });
  it('圖組裡的圖也算', () => {
    const c = base();
    c.tales[0] = { ...c.tales[0]!, content: body(blk({ blockType: 'gallery', items: [{ media: 1 }, { media: 2 }] })) };
    expect(missingDeps(c).media).toEqual(['1', '2']);
  });
});

import { integrityAll } from './request';
describe('integrityAll：每一類內容都有下限，不只文章', () => {
  const last = { tales: 20, routes: 4, reels: 3, redirects: 40 };
  it('照常（多了、或一樣多）→ 通過', () => expect(integrityAll({ last, fetched: { tales: 21, routes: 4, reels: 3, redirects: 41 }, expectedRemovals: {} }).ok).toBe(true));
  it('影片少了一支，這次又不是撤下影片 → 拒絕', () => {
    const r = integrityAll({ last, fetched: { tales: 20, routes: 4, reels: 2, redirects: 40 }, expectedRemovals: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/reels/);
  });
  it('撤下一條路線 → 路線可以少一條', () => expect(integrityAll({ last, fetched: { tales: 20, routes: 3, reels: 3, redirects: 40 }, expectedRemovals: { routes: 1 } }).ok).toBe(true));
  it('轉址整批不見（API 回了空的）→ 拒絕；少幾條（本人刪了）→ 通過', () => {
    expect(integrityAll({ last, fetched: { tales: 20, routes: 4, reels: 3, redirects: 0 }, expectedRemovals: {} }).ok).toBe(false);
    expect(integrityAll({ last, fetched: { tales: 20, routes: 4, reels: 3, redirects: 38 }, expectedRemovals: {} }).ok).toBe(true);
  });
  it('上次的 manifest 沒有某一類的數字（舊格式）→ 那一類不檢查', () =>
    expect(integrityAll({ last: { tales: 20 }, fetched: { tales: 20, routes: 0, reels: 0, redirects: 0 }, expectedRemovals: {} }).ok).toBe(true));
});

import { applySnapshot, planRequestRedirects, referencesOf, remapRefs } from './request';
describe('referencesOf：一份文件引用了哪些東西（frontmatter 與正文的區塊都算）', () => {
  it('文章：hero、video、route，加上正文裡的圖、圖組、影片、路線區塊', () => {
    const r = referencesOf('tales', {
      id: 1, hero: 5, video: { id: 7 }, route: 9,
      content: body(blk({ blockType: 'figure', media: 6 }), blk({ blockType: 'gallery', items: [{ media: 8 }] }), blk({ blockType: 'video', reel: 70 }), blk({ blockType: 'route', route: { id: 90 } })),
    });
    expect({ media: [...r.media].sort(), reels: [...r.reels].sort(), routes: [...r.routes].sort() }).toEqual({ media: ['5', '6', '8'], reels: ['7', '70'], routes: ['9', '90'] });
  });
  it('路線引用封面、影片引用海報', () => {
    expect([...referencesOf('routes', { id: 1, cover: 3 }).media]).toEqual(['3']);
    expect([...referencesOf('reels', { id: 1, poster: 4 }).media]).toEqual(['4']);
  });
});

describe('applySnapshot：建置的是送出那一刻的快照，依賴也在裡面', () => {
  const snap = (deps: { collection: 'routes' | 'reels'; id: number; data: Record<string, unknown> }[] = []) => ({
    doc: { collection: 'tales' as const, id: 2, versionId: 'v2', data: { id: 2, title: 'b', slug: 'b', date: '2026-02-01', route: 9, content: body() } },
    deps: deps.map((d) => ({ ...d, versionId: `v${d.id}` })), takenAt: '2026-10-16T00:00:00.000Z',
  });
  it('文章與它還沒上線的路線一起進語料', () => {
    const c = applySnapshot(base(), { kind: 'publish', collection: 'tales', docId: '2' }, snap([{ collection: 'routes', id: 9, data: { id: 9, slug: 'r' } }]));
    expect(c.tales.map((t) => t.id)).toEqual([1, 2]);
    expect(c.routes.map((r) => r.id)).toEqual([9]);
  });
  it('快照裡少了依賴（又不在已上線的內容裡）→ 拒絕，並說是哪一個', () => {
    expect(() => applySnapshot(base(), { kind: 'publish', collection: 'tales', docId: '2' }, snap())).toThrow(/routes.*9/);
  });
  it('已上線的依賴用已上線的版本，不被快照以外的東西取代', () => {
    const live = { ...base(), routes: [{ id: 9, slug: 'live' } as never] };
    expect(applySnapshot(live, { kind: 'publish', collection: 'tales', docId: '2' }, snap()).routes.map((r) => (r as { slug: string }).slug)).toEqual(['live']);
  });
  it('快照屬於別的文件 → 拒絕', () => {
    expect(() => applySnapshot(base(), { kind: 'publish', collection: 'tales', docId: '3' }, snap())).toThrow(/快照/);
  });
});

describe('planRequestRedirects：這一筆請求造成的網址變化，建置時就要反映（不等定案）', () => {
  const live = (): Corpus => ({ ...base(), redirects: [{ from: '/blog/old/', to: '/tales/2026/a/' }] });
  it('已上線的文章改 slug：舊網址 301 到新網址，指向舊網址的轉址改指新網址', () => {
    const c = planRequestRedirects(live(), { kind: 'publish', collection: 'tales', docId: '1' }, { id: 1, slug: 'a2', date: '2026-01-01' });
    expect(c.redirects).toEqual(expect.arrayContaining([{ from: '/blog/old/', to: '/tales/2026/a2/' }, { from: '/tales/2026/a/', to: '/tales/2026/a2/' }]));
    expect(c.redirects).toHaveLength(2);
  });
  it('新文章（之前不在線上）：不加轉址', () => {
    expect(planRequestRedirects(live(), { kind: 'publish', collection: 'tales', docId: '5' }, { id: 5, slug: 'n', date: '2026-01-01' }).redirects).toEqual(live().redirects);
  });
  it('撤下被轉址指著的文章：拿掉指向它的轉址（否則 verify-links 永遠失敗、這筆永遠發不出去）', () => {
    expect(planRequestRedirects(live(), { kind: 'unpublish', collection: 'tales', docId: '1' }).redirects).toEqual([]);
  });
  it('不是文章 → 原樣', () => {
    expect(planRequestRedirects(live(), { kind: 'unpublish', collection: 'routes', docId: '1' })).toEqual(live());
  });
});

// 防的失敗：遷移後正文裡還留著語料的本機 id，指到後台裡另一張圖、另一支影片或另一條路線
describe('remapRefs', () => {
  const blk = (fields: Record<string, unknown>) => ({ type: 'block', fields });
  const tale = {
    slug: 't', hero: 1, video: 2, route: 3,
    content: { root: { type: 'root', children: [
      { type: 'paragraph', children: [{ type: 'text', text: 'x' }] },
      blk({ blockType: 'figure', media: 4 }),
      blk({ blockType: 'gallery', items: [{ media: 5 }, { media: { id: 6 } }] }),
      blk({ blockType: 'video', reel: 2 }),
      blk({ blockType: 'route', route: 3 }),
    ] } },
  };
  const plus = (ids: number[], d: number) => new Map(ids.map((i) => [String(i), i + d]));
  const map = { media: plus([1, 4, 5, 6], 100), reels: plus([2], 200), routes: plus([3], 300) };

  it('referencesOf 看得到的每一個引用都換掉了', () => {
    const out = remapRefs('tales', tale, map);
    const r = referencesOf('tales', out);
    expect([...r.media].sort()).toEqual(['101', '104', '105', '106']);
    expect([...r.reels]).toEqual(['202']);
    expect([...r.routes]).toEqual(['303']);
  });
  it('不改到原本的物件', () => {
    remapRefs('tales', tale, map);
    expect(tale.hero).toBe(1);
  });
  it('有引用找不到新 id → 丟錯並指出是哪一個', () => {
    const m = { ...map, media: plus([1, 4, 5], 100) };
    expect(() => remapRefs('tales', tale, m)).toThrow(/media 6/);
  });
  it('路線的封面、影片的 poster 也換', () => {
    expect(remapRefs('routes', { cover: 4 }, map).cover).toBe(104);
    expect(remapRefs('reels', { poster: 5 }, map).poster).toBe(105);
  });
});
