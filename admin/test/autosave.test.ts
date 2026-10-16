import { describe, expect, it } from 'vitest';
import { createAutosave } from '../src/editor/autosave';

/** 假時鐘：不真的等 */
function harness(over: { save?: () => Promise<void>; blocked?: () => boolean } = {}) {
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const saves: number[] = [];
  const states: string[] = [];
  const a = createAutosave({
    now: () => t,
    setTimer: (fn, ms) => { const h = { at: t + ms, fn, id: ++id }; timers.push(h); return h.id; },
    clearTimer: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    save: over.save ?? (async () => { saves.push(t); }),
    blocked: over.blocked,
    onState: (s) => states.push(s),
  });
  const advance = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((x, y) => x.at - y.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift(); t = next.at; next.fn();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    t = end;
  };
  return { a, advance, saves, states, now: () => t, timers };
}

describe('自動存檔節奏', () => {
  it('閒置 3 秒才存；中途又改就重新計時', async () => {
    const h = harness();
    h.a.markDirty();
    await h.advance(2900); expect(h.saves).toEqual([]);
    h.a.markDirty(); // 重新計時
    await h.advance(2900); expect(h.saves).toEqual([]);
    await h.advance(200); expect(h.saves).toHaveLength(1);
    expect(h.a.state).toBe('saved');
  });
  it('兩次存檔至少相隔 30 秒', async () => {
    const h = harness();
    h.a.markDirty(); await h.advance(3000);
    expect(h.saves).toEqual([3000]);
    h.a.markDirty(); // 剛存完又改
    await h.advance(10_000); expect(h.saves).toEqual([3000]); // 還沒到 30 秒
    await h.advance(20_000); expect(h.saves).toEqual([3000, 33_000]);
  });
  it('被擋住（上傳中）就不存，放行後才存', async () => {
    let blocked = true;
    const h = harness({ blocked: () => blocked });
    h.a.markDirty(); await h.advance(10_000);
    expect(h.saves).toEqual([]);
    expect(h.a.state).toBe('dirty');
    blocked = false; await h.advance(1500);
    expect(h.saves).toHaveLength(1);
  });
  it('存檔進行中又有變更：不會並行存，結束後補存一次', async () => {
    let release!: () => void;
    let inFlight = 0, maxInFlight = 0, n = 0;
    const h = harness({ save: () => new Promise<void>((res) => { n++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); release = () => { inFlight--; res(); }; }) });
    h.a.markDirty(); await h.advance(3000);
    expect(h.a.state).toBe('saving');
    h.a.markDirty(); await h.advance(5000);
    expect(n).toBe(1);
    release(); await h.advance(0);
    expect(h.a.state).toBe('dirty'); // 補存排程中
    await h.advance(40_000);
    expect(n).toBe(2);
    expect(maxInFlight).toBe(1);
    release(); await h.advance(0);
    expect(h.a.state).toBe('saved');
  });
  it('失敗：不吞掉，狀態是 error，指數退避重試，成功後恢復', async () => {
    let fail = 2;
    const h = harness({ save: async () => { if (fail-- > 0) throw new Error('503'); } });
    h.a.markDirty(); await h.advance(3000);
    expect(h.a.state).toBe('error');
    await h.advance(2000); expect(h.a.state).toBe('error');   // 第二次失敗
    await h.advance(4000); expect(h.a.state).toBe('saved');   // 第三次成功
    expect(h.states).toContain('error');
  });
  it('flush：立刻存；被擋住時回 false（呼叫端不能繼續發佈）', async () => {
    let blocked = false;
    const h = harness({ blocked: () => blocked });
    h.a.markDirty();
    expect(await h.a.flush()).toBe(true);
    expect(h.saves).toEqual([0]);
    h.a.markDirty(); blocked = true;
    expect(await h.a.flush()).toBe(false);
  });
  it('flush 時剛好有一個存檔在飛：等它結束，再把之後的變更存掉，回 true（先前直接回 false，發佈被擋還說「有圖片在上傳」）', async () => {
    let release!: () => void; let n = 0;
    const h = harness({ save: () => new Promise<void>((res) => { n++; release = res; }) });
    h.a.markDirty(); await h.advance(3000);
    expect(h.a.state).toBe('saving');
    h.a.markDirty();                       // 存檔期間又改了
    const done = h.a.flush();
    release(); await h.advance(0);         // 第一個存檔結束
    await Promise.resolve(); await Promise.resolve();
    release();                             // flush 補存的那一次
    expect(await done).toBe(true);
    expect(n).toBe(2);
    expect(h.a.state).toBe('saved');
  });
  it('沒有變更時 flush 不會多存一次', async () => {
    const h = harness();
    expect(await h.a.flush()).toBe(true);
    expect(h.saves).toEqual([]);
  });
});
