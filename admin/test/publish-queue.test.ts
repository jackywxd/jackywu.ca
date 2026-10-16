import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS, WATCHDOG_MS, applyResult, checkIntegrity, dependencyClosure, enqueue,
  markDispatched, nextToDispatch, planRevoke, watchdog, type PublishRequest,
} from '../src/lib/publish-queue';

const T0 = 1_000_000;
const add = (q: PublishRequest[], id: string, t = T0, docId = id, v = 'v1') =>
  enqueue(q, { id, kind: 'publish', docId, versionId: v }, t);

describe('enqueue / dispatch', () => {
  it('FIFO，一次只送一筆', () => {
    let q = add(add(add([], 'a', 1), 'b', 2), 'c', 3);
    expect(nextToDispatch(q)?.id).toBe('a');
    q = markDispatched(q, 'a', 10);
    expect(nextToDispatch(q)).toBeNull(); // a 進行中，b 不能搶跑
    expect(() => markDispatched(q, 'b', 11)).toThrow(/另一筆/);
  });
  it('連按兩次發佈（同文件同版本）只留一筆', () => {
    const q = add(add([], 'a', 1, 'doc1', 'v1'), 'b', 2, 'doc1', 'v1');
    expect(q).toHaveLength(1);
  });
  it('同文件不同版本是兩筆（發佈後又改了）', () => {
    const q = add(add([], 'a', 1, 'doc1', 'v1'), 'b', 2, 'doc1', 'v2');
    expect(q).toHaveLength(2);
  });
  it('id 重複 → throw', () => {
    expect(() => add(add([], 'a', 1, 'd1'), 'a', 2, 'd2')).toThrow(/重複/);
  });
});

describe('一篇壞稿永遠擋不到其他文章', () => {
  it('第 2 筆失敗，第 1、3 筆照常上線', () => {
    let q = add(add(add([], 'a', 1), 'b', 2), 'c', 3);
    const run = (id: string, ok: boolean) => {
      q = markDispatched(q, id, 10);
      q = applyResult(q, id, ok ? { ok: true } : { ok: false, check: 'verify-og-crop', summary: '超出中央 560px' }, 20);
    };
    run('a', true);
    expect(nextToDispatch(q)?.id).toBe('b');
    run('b', false);
    expect(nextToDispatch(q)?.id).toBe('c');
    run('c', true);
    expect(q.map((r) => r.status)).toEqual(['deployed', 'failed', 'deployed']);
    expect(q[1]!.failure).toMatchObject({ check: 'verify-og-crop' });
    expect(nextToDispatch(q)).toBeNull();
  });
});

describe('回呼冪等', () => {
  it('同一個結果送兩次，狀態不變', () => {
    let q = markDispatched(add([], 'a'), 'a', 10);
    q = applyResult(q, 'a', { ok: true }, 20);
    const again = applyResult(q, 'a', { ok: true }, 99);
    expect(again).toEqual(q);
  });
  it('已定案後來了相反的結果：以先到者為準', () => {
    let q = markDispatched(add([], 'a'), 'a', 10);
    q = applyResult(q, 'a', { ok: true }, 20);
    q = applyResult(q, 'a', { ok: false, check: 'x', summary: 'y' }, 30);
    expect(q[0]!.status).toBe('deployed');
  });
  it('還沒送出就收到結果 → throw', () => {
    expect(() => applyResult(add([], 'a'), 'a', { ok: true }, 1)).toThrow(/未送出/);
  });
});

describe('看門狗', () => {
  const dispatched = () => markDispatched(add([], 'a'), 'a', T0);
  it('run 被取消 → 重新排隊，不算失敗', () => {
    const q = watchdog(dispatched(), { a: 'cancelled' }, T0 + 1000);
    expect(q[0]).toMatchObject({ status: 'queued', attempts: 1 });
    expect(nextToDispatch(q)?.id).toBe('a');
  });
  it(`連續被取消 ${MAX_ATTEMPTS} 次才放棄`, () => {
    let q = add([], 'a');
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      q = markDispatched(q, 'a', T0 + i);
      q = watchdog(q, { a: 'cancelled' }, T0 + i + 1);
    }
    expect(q[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
  });
  it('超過時限沒有結果 → 失敗，並放行下一筆', () => {
    let q = add(dispatched(), 'b', T0 + 1);
    q = watchdog(q, {}, T0 + WATCHDOG_MS + 1);
    expect(q[0]!.status).toBe('failed');
    expect(nextToDispatch(q)?.id).toBe('b');
  });
  it('時限內仍在跑 → 不動', () => {
    const q = dispatched();
    expect(watchdog(q, { a: 'in_progress' }, T0 + WATCHDOG_MS - 1)).toEqual(q);
  });
  it('workflow 已 failure 但沒回呼 → 失敗', () => {
    expect(watchdog(dispatched(), { a: 'failure' }, T0 + 5)[0]!.status).toBe('failed');
  });
  it('workflow 顯示 success 卻沒回呼 → 不能當成已發佈', () => {
    const r = watchdog(dispatched(), { a: 'success' }, T0 + 5)[0]!;
    expect(r.status).toBe('failed');
    expect(r.failure?.check).toBe('callback-missing');
  });
  it('只處理 dispatched，不碰 queued 與已定案的', () => {
    let q = add([], 'a');
    expect(watchdog(q, { a: 'cancelled' }, T0 + WATCHDOG_MS * 9)).toEqual(q);
  });
});

describe('依賴閉包', () => {
  const published = new Set(['routes/2026/x', 'img/1']);
  it('只帶上還沒上線的依賴', () => {
    expect(
      dependencyClosure({ id: 't', route: 'routes/2026/x', video: 'reel/2026/v', media: ['img/1', 'img/2'] }, published),
    ).toEqual({ routes: [], reels: ['reel/2026/v'], media: ['img/2'] });
  });
  it('沒有引用 → 全空', () => {
    expect(dependencyClosure({ id: 't', media: [] }, published)).toEqual({ routes: [], reels: [], media: [] });
  });
});

describe('完整性護欄', () => {
  it('少於下限 → 拒絕', () => {
    const r = checkIntegrity({ lastDeployedCount: 29, fetchedCount: 0, expectedRemovals: 0 });
    expect(r.ok).toBe(false);
  });
  it('剛好等於下限 → 通過；撤下一篇時可少一篇', () => {
    expect(checkIntegrity({ lastDeployedCount: 29, fetchedCount: 28, expectedRemovals: 1 }).ok).toBe(true);
    expect(checkIntegrity({ lastDeployedCount: 29, fetchedCount: 27, expectedRemovals: 1 }).ok).toBe(false);
  });
  it('新增文章（多於上次）通過', () => {
    expect(checkIntegrity({ lastDeployedCount: 29, fetchedCount: 31, expectedRemovals: 0 }).ok).toBe(true);
  });
});

describe('撤回公開媒體', () => {
  const set = (...k: string[]) => new Set(k);
  it('只撤 promoted 裡、manifest 已不再引用的', () => {
    const m = set(...Array.from({ length: 10 }, (_, i) => `k${i}`));
    const r = planRevoke({ promoted: set('k1', 'old'), manifest: m });
    expect(r).toEqual({ ok: true, keys: ['old'] });
  });
  it('不在 promoted 的永遠不會被列入（不碰別人的東西）', () => {
    const r = planRevoke({ promoted: set('a'), manifest: set('a', 'b') });
    expect(r).toEqual({ ok: true, keys: [] });
  });
  it('超過 20% → 中止並說明', () => {
    const m = set('k1', 'k2', 'k3', 'k4', 'k5');
    const r = planRevoke({ promoted: set('k1', 'k2', 'k3', 'k4', 'k5', 'x', 'y', 'z'), manifest: m });
    expect(r.ok).toBe(false);
    expect(r.keys).toEqual(['x', 'y', 'z']);
  });
});
