import { describe, expect, it } from 'vitest';
import {
  checkDate, checkExcerpt, checkSlug, checkTitle, displayWidth, taleId, validateTale,
} from './index';

const ok = {
  title: '雪山上的一天', slug: 'snow-day', date: '2026-01-15', realm: 'snow',
  excerpt: '在雪山上走了一整天，風很大，人很少，回來之後什麼都記得。', shareable: true,
};

describe('displayWidth', () => {
  it('CJK 算 2，其餘算 1', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('雪山')).toBe(4);
    expect(displayWidth('a雪b')).toBe(4);
    expect(displayWidth('，')).toBe(2); // 全形逗號在 FF00–FF60
  });
});

describe('slug', () => {
  it.each(['a', 'whistler-100k', '2026-recap'])('接受 %s', (s) => expect(checkSlug(s)).toBeNull());
  it.each(['', 'Foo', 'a_b', 'a--b', '-a', 'a-', '雪山', 'a b'])('拒絕 %j', (s) =>
    expect(checkSlug(s)).not.toBeNull());
});

describe('date', () => {
  it('只收 YYYY-MM-DD 且是真的日期', () => {
    expect(checkDate('2026-02-28')).toBeNull();
    expect(checkDate('2026-02-30')).not.toBeNull();
    expect(checkDate('2026-2-3')).not.toBeNull();
    expect(checkDate('2026-01-01T00:00:00Z')).not.toBeNull();
  });
  it('年份用字串切，不受時區影響', () => {
    expect(taleId('2026-12-31', 'x')).toBe('2026/x');
  });
});

describe('邊界', () => {
  it('標題：顯示寬度 120 剛好過、121 不過', () => {
    expect(checkTitle('雪'.repeat(60))).toBeNull();
    expect(checkTitle('雪'.repeat(60) + 'a')).not.toBeNull();
    expect(checkTitle('')).not.toBeNull();
  });
  it('摘要：寬度 20 剛好過、19 不過；200 過、201 不過', () => {
    expect(checkExcerpt('a'.repeat(20))).toBeNull();
    expect(checkExcerpt('a'.repeat(19))).not.toBeNull();
    expect(checkExcerpt('a'.repeat(200))).toBeNull();
    expect(checkExcerpt('a'.repeat(201))).not.toBeNull();
  });
});

describe('validateTale', () => {
  it('合格的文章沒有錯誤', () => expect(validateTale(ok)).toEqual([]));
  it('路線圖當封面：要先選文章的路線；不能同時有封面圖；替代文字照樣必填', () => {
    expect(validateTale({ ...ok, heroRoute: true, route: 7, heroAlt: '路線圖' })).toEqual([]);
    expect(validateTale({ ...ok, heroRoute: true, route: null, heroAlt: '路線圖' }).map((e) => e.field)).toEqual(['heroRoute']);
    expect(validateTale({ ...ok, heroRoute: true, route: 7, hero: 'img/a.jpg', heroAlt: 'x' }).map((e) => e.field)).toEqual(['heroRoute']);
    expect(validateTale({ ...ok, heroRoute: true, route: 7 }).map((e) => e.field)).toEqual(['heroAlt']);
    expect(validateTale({ ...ok, heroRoute: false, route: null })).toEqual([]);
  });
  it('hero 沒有 heroAlt → 錯誤指向 heroAlt', () => {
    expect(validateTale({ ...ok, hero: 'img/2026/abc.jpg' })).toEqual([
      expect.objectContaining({ field: 'heroAlt' }),
    ]);
  });
  it('still 必須 shareable:false，未設定也算違規', () => {
    expect(validateTale({ ...ok, realm: 'still', shareable: true })[0]?.field).toBe('shareable');
    expect(validateTale({ ...ok, realm: 'still', shareable: undefined })[0]?.field).toBe('shareable');
    expect(validateTale({ ...ok, realm: 'still', shareable: false })).toEqual([]);
  });
  it('多個錯誤一次全列出，不是遇到第一個就停', () => {
    const fields = validateTale({ ...ok, slug: 'X', date: 'nope', realm: 'zzz' }).map((e) => e.field);
    expect(fields).toEqual(['slug', 'date', 'realm']);
  });
});
