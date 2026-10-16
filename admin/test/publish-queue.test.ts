import { describe, expect, it } from 'vitest';
import {
  HARD_MS, MAX_ATTEMPTS, NO_RUN_MS, applyResult, checkIntegrity, dependencyClosure, enqueue,
  markDispatched, nextToDispatch, watchdog, type PublishRequest,
} from '../src/lib/publish-queue';

const T0 = 1_000_000;
const add = (q: PublishRequest[], id: string, t = T0, docId = id, v = 'v1') =>
  enqueue(q, { id, kind: 'publish', collection: 'tales', docId, versionId: v }, t);

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
  it('看門狗判失敗之後才收到成功回呼：網站確實上線了，改判已上線（不能讓網站與後台不一致）', () => {
    let q = markDispatched(add([], 'a'), 'a', 10);
    q = watchdog(q, { a: 'success' }, 20);
    expect(q[0]!.status).toBe('failed');
    q = applyResult(q, 'a', { ok: true }, 30);
    expect(q[0]).toMatchObject({ status: 'deployed', late: true });
  });
  it('已定案後來了相反的結果：成功之後的失敗回呼忽略', () => {
    let q = markDispatched(add([], 'a'), 'a', 10);
    q = applyResult(q, 'a', { ok: true }, 20);
    q = applyResult(q, 'a', { ok: false, check: 'x', summary: 'y' }, 30);
    expect(q[0]!.status).toBe('deployed');
  });
  it('重新排隊之後才收到舊 run 的結果：成功就是已上線，失敗則忽略（排隊中的會再跑一次）', () => {
    expect(applyResult(add([], 'a'), 'a', { ok: true }, 1)[0]).toMatchObject({ status: 'deployed', late: true });
    expect(applyResult(add([], 'a'), 'a', { ok: false, check: 'x', summary: 'y' }, 1)[0]!.status).toBe('queued');
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
  it('送出後一直找不到這一次的 run → 重新排隊（算一次嘗試），不是直接失敗', () => {
    const q = watchdog(dispatched(), {}, T0 + NO_RUN_MS + 1);
    expect(q[0]).toMatchObject({ status: 'queued', attempts: 1 });
  });
  it('找不到 run 的次數用完 → 失敗，並放行下一筆', () => {
    let q = add(add([], 'a'), 'b', T0 + 1);
    for (let i = 0; i < MAX_ATTEMPTS; i++) { q = markDispatched(q, 'a', T0 + i); q = watchdog(q, {}, T0 + i + NO_RUN_MS + 1); }
    expect(q[0]!.status).toBe('failed');
    expect(nextToDispatch(q)?.id).toBe('b');
  });
  it('run 還在跑（含在 concurrency 群組裡排隊）→ 不動，不管等了多久', () => {
    // 先前的版本在 25 分鐘時把它判失敗，run 之後照樣部署成功，網站與後台從此不一致
    const q = dispatched();
    expect(watchdog(q, { a: 'in_progress' }, T0 + 2 * 60 * 60 * 1000)).toEqual(q);
  });
  it('run 卡住超過硬上限 → 失敗（佇列不能永遠不動）', () => {
    expect(watchdog(dispatched(), { a: 'in_progress' }, T0 + HARD_MS + 1)[0]!.status).toBe('failed');
  });
  it('run 結束但沒有回呼，而線上的 manifest 就是這一筆 → 判已上線', () => {
    for (const c of ['success', 'failure'] as const) {
      expect(watchdog(dispatched(), { a: c }, T0 + 5, 'a')[0]).toMatchObject({ status: 'deployed', late: true });
    }
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
    expect(watchdog(q, { a: 'cancelled' }, T0 + HARD_MS * 9)).toEqual(q);
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
