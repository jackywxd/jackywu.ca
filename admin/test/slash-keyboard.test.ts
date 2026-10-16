import { describe, expect, it } from 'vitest';
import { keyboardInset } from '../src/editor/keyboard';
import { filterSlash, SLASH_ITEMS } from '../src/editor/slash';

describe('filterSlash', () => {
  it('沒有輸入 → 全部，順序固定', () => expect(filterSlash('')).toEqual(SLASH_ITEMS));
  it('中文、英文關鍵字都找得到', () => {
    expect(filterSlash('圖')[0]!.id).toBe('figure');
    expect(filterSlash('image')[0]!.id).toBe('figure');
    expect(filterSlash('gpx')[0]!.id).toBe('route');
    expect(filterSlash('影')[0]!.id).toBe('video');
  });
  it('開頭符合優先於只是包含', () => {
    const r = filterSlash('h');
    expect(r.slice(0, 4).map((i) => i.id)).toEqual(expect.arrayContaining(['h2', 'h3', 'h4']));
  });
  it('不分大小寫與前後空白', () => expect(filterSlash('  TABLE ')[0]!.id).toBe('table'));
  it('沒有符合 → 空陣列（選單要關掉，不是顯示全部）', () => expect(filterSlash('zzzzqqq')).toEqual([]));
  it('每個項目的 id 唯一，且都有標籤', () => {
    expect(new Set(SLASH_ITEMS.map((i) => i.id)).size).toBe(SLASH_ITEMS.length);
    for (const i of SLASH_ITEMS) expect(i.label.length).toBeGreaterThan(0);
  });
});

describe('keyboardInset', () => {
  it('沒有鍵盤 → 0', () => expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toBe(0));
  it('鍵盤 300px', () => expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300));
  it('視窗被捲動（offsetTop）時要扣掉', () => expect(keyboardInset(800, { height: 450, offsetTop: 50 })).toBe(300));
  it('網址列伸縮（< 80px）不當成鍵盤', () => expect(keyboardInset(800, { height: 740, offsetTop: 0 })).toBe(0));
  it('不會回傳負數', () => expect(keyboardInset(800, { height: 900, offsetTop: 0 })).toBe(0));
});
