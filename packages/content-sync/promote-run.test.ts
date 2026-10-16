import { describe, expect, it } from 'vitest';
import { runPromote, runRevoke, type ReadStore, type WriteStore } from './promote-run';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  const calls: string[] = [];
  const store: ReadStore & WriteStore = {
    async keys() { return new Set(m.keys()); },
    async get(k) { const v = m.get(k); return v === undefined ? null : { body: new TextEncoder().encode(v), size: v.length }; },
    async put(k, body) { calls.push(`put ${k}`); m.set(k, new TextDecoder().decode(body as Uint8Array)); },
    async delete(k) { calls.push(`delete ${k}`); m.delete(k); },
  };
  return { store, m, calls };
};

describe('runPromote', () => {
  it('複製缺的、跳過已有的，並確認公開端真的有了', async () => {
    const src = mem({ 'video/a/1080p.mp4': 'A', 'video/b/1080p.mp4': 'B' });
    const dst = mem({ 'video/a/1080p.mp4': 'A' });
    const r = await runPromote({ manifest: ['video/a/1080p.mp4', 'video/b/1080p.mp4'], source: src.store, target: dst.store });
    expect(r.copied).toEqual(['video/b/1080p.mp4']);
    expect(dst.calls).toEqual(['put video/b/1080p.mp4']);
    expect(dst.m.get('video/b/1080p.mp4')).toBe('B');
  });
  it('私有端缺依賴 → 中止，公開端一個字都沒寫', async () => {
    const dst = mem();
    await expect(runPromote({ manifest: ['video/x/1080p.mp4'], source: mem().store, target: dst.store })).rejects.toThrow(/依賴沒有上傳完成/);
    expect(dst.calls).toEqual([]);
  });
  it('manifest 含 img/ → 一個都不複製', async () => {
    const src = mem({ 'video/a/1080p.mp4': 'A', 'img/s.jpg': 'S' });
    const dst = mem();
    await expect(runPromote({ manifest: ['video/a/1080p.mp4', 'img/s.jpg'], source: src.store, target: dst.store })).rejects.toThrow(/不允許公開/);
    expect(dst.calls).toEqual([]);
  });
  it('私有端的 img/、trash/ 即使存在也不會被當成可複製', async () => {
    const src = mem({ 'img/x.jpg': 'X' });
    const dst = mem();
    await expect(runPromote({ manifest: ['video/a/1080p.mp4'], source: src.store, target: dst.store })).rejects.toThrow(/找不到/);
  });
  it('寫入沒有生效（公開端仍缺）→ 報錯，不讓部署繼續', async () => {
    const src = mem({ 'video/a/1080p.mp4': 'A' });
    const dst = mem();
    dst.store.put = async () => {}; // 壞掉的目標：吞掉寫入
    await expect(runPromote({ manifest: ['video/a/1080p.mp4'], source: src.store, target: dst.store })).rejects.toThrow(/仍缺/);
  });
});

describe('runRevoke', () => {
  const manifest = new Set(Array.from({ length: 10 }, (_, i) => `video/v${i}/1080p.mp4`));
  it('只刪 promoted 記錄過、且 manifest 不再引用的 key，逐 key', async () => {
    const dst = mem({ 'video/old/1080p.mp4': 'O', 'video/v1/1080p.mp4': '1', 'video/stranger/1080p.mp4': 'S' });
    const r = await runRevoke({ promoted: new Set(['video/old/1080p.mp4', 'video/v1/1080p.mp4']), manifest, target: dst.store });
    expect(r.revoked).toEqual(['video/old/1080p.mp4']);
    expect(dst.calls).toEqual(['delete video/old/1080p.mp4']);
    expect(dst.m.has('video/stranger/1080p.mp4')).toBe(true); // 不是我們 promote 的，不碰
  });
  it('超過上限 → 一個都不刪，回傳原因', async () => {
    const keys = ['video/a/x.mp4', 'video/b/x.mp4', 'video/c/x.mp4'];
    const dst = mem(Object.fromEntries(keys.map((k) => [k, 'x'])));
    const r = await runRevoke({ promoted: new Set(keys), manifest, target: dst.store });
    expect(r.revoked).toEqual([]);
    expect(r.aborted).toMatch(/超過上限/);
    expect(dst.calls).toEqual([]);
  });
});
