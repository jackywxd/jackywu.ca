import { describe, expect, it } from 'vitest';
import { encodePath, planTaleRedirects } from '../src/lib/redirects';

const plan = (b: [string, string], a: [string, string], existing: { from: string; to: string }[] = []) =>
  planTaleRedirects({ before: { date: b[0], slug: b[1] }, after: { date: a[0], slug: a[1] }, existing });

describe('planTaleRedirects', () => {
  it('改 slug → 舊網址轉新網址', () => {
    expect(plan(['2026-01-02', 'old'], ['2026-01-02', 'new'])).toEqual({
      create: [{ from: '/tales/2026/old/', to: '/tales/2026/new/' }], retarget: [], remove: [],
    });
  });
  it('改日期跨年 → 資料夾（網址）跟著變', () => {
    expect(plan(['2025-12-31', 'x'], ['2026-01-01', 'x']).create).toEqual([
      { from: '/tales/2025/x/', to: '/tales/2026/x/' },
    ]);
  });
  it('同年改日期、slug 不變 → 網址沒變，什麼都不做', () => {
    expect(plan(['2026-01-02', 'x'], ['2026-06-02', 'x'])).toEqual({ create: [], retarget: [], remove: [] });
  });
  it('轉址鏈：A→B 之後 B 改成 C，A 要直接轉 C', () => {
    const r = plan(['2026-01-01', 'b'], ['2026-01-01', 'c'], [{ from: '/tales/2026/a/', to: '/tales/2026/b/' }]);
    expect(r.retarget).toEqual([{ from: '/tales/2026/a/', to: '/tales/2026/c/' }]);
    expect(r.create).toEqual([{ from: '/tales/2026/b/', to: '/tales/2026/c/' }]);
  });
  it('改回舊名：不能留下自己轉自己', () => {
    const r = plan(['2026-01-01', 'b'], ['2026-01-01', 'a'], [{ from: '/tales/2026/a/', to: '/tales/2026/b/' }]);
    expect(r.remove).toEqual(['/tales/2026/a/']);
    expect(r.retarget).toEqual([]);
    expect(r.create).toEqual([{ from: '/tales/2026/b/', to: '/tales/2026/a/' }]);
  });
  it('已經有同一來源的轉址就不重複建立', () => {
    const r = plan(['2026-01-01', 'a'], ['2026-01-01', 'b'], [{ from: '/tales/2026/a/', to: '/tales/2026/z/' }]);
    expect(r.create).toEqual([]);
  });
});

describe('encodePath', () => {
  it('空白一律 %20（_redirects 以空白分欄）', () => {
    expect(encodePath('/blog/a b/c d/')).toBe('/blog/a%20b/c%20d/');
  });
});
