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
