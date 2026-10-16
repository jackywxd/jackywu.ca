import { describe, expect, it } from 'vitest';
import { clearLocal, compareLocal, readLocal, writeLocal } from '../src/lib/local-draft';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

describe('本機備份', () => {
  it('寫了就讀得到，清了就沒有', () => {
    const s = mem();
    writeLocal('7', { meta: { title: 'x' }, content: { a: 1 }, at: 5 }, s);
    expect(readLocal('7', s)).toMatchObject({ meta: { title: 'x' }, at: 5 });
    clearLocal('7', s);
    expect(readLocal('7', s)).toBeNull();
  });
  it('新稿與已存在的稿用不同的鍵', () => {
    const s = mem();
    writeLocal(null, { meta: {}, content: null, at: 1 }, s);
    expect(readLocal('7', s)).toBeNull();
    expect(readLocal(null, s)).not.toBeNull();
  });
  it('壞掉的內容、拿不到 storage 都不丟錯', () => {
    expect(readLocal('1', { getItem: () => '{bad' })).toBeNull();
    expect(readLocal('1', null)).toBeNull();
    expect(() => writeLocal('1', { meta: {}, content: null, at: 1 }, { setItem: () => { throw new Error('quota'); } })).not.toThrow();
    expect(() => writeLocal('1', { meta: {}, content: null, at: 1 }, null)).not.toThrow();
  });
});

describe('compareLocal', () => {
  const T = (s: string) => Date.parse(s);
  it('沒有備份 → 用伺服器', () => expect(compareLocal(null, '2026-01-01T00:00:00Z')).toBe('use-server'));
  it('備份比伺服器新、且伺服器沒有被別處改過 → 本機較新', () => {
    expect(compareLocal({ meta: {}, content: null, at: T('2026-01-02T00:00:00Z'), baseUpdatedAt: '2026-01-01T00:00:00Z' }, '2026-01-01T00:00:00Z')).toBe('local-newer');
  });
  it('伺服器在備份之後又被改過（另一台裝置）→ 衝突，不自動選邊', () => {
    expect(compareLocal({ meta: {}, content: null, at: T('2026-01-02T00:00:00Z'), baseUpdatedAt: '2026-01-01T00:00:00Z' }, '2026-01-03T00:00:00Z')).toBe('conflict');
  });
  it('備份比伺服器舊 → 用伺服器（備份是過期的）', () => {
    expect(compareLocal({ meta: {}, content: null, at: T('2026-01-01T00:00:00Z') }, '2026-01-02T00:00:00Z')).toBe('use-server');
  });
  it('備份的基準就是伺服器目前這一版 → 本機較新，不管兩邊時鐘（手機慢幾秒時，先前會判成「用伺服器」並刪掉沒存的編輯）', () => {
    expect(compareLocal({ meta: {}, content: null, at: T('2026-01-01T00:00:00Z') - 5000, baseUpdatedAt: '2026-01-01T00:00:00Z' }, '2026-01-01T00:00:00Z')).toBe('local-newer');
  });
  it('新稿（伺服器還沒有）有備份 → 本機較新', () => expect(compareLocal({ meta: {}, content: null, at: 1 }, null)).toBe('local-newer'));
});
