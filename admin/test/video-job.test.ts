import { describe, expect, it } from 'vitest';
import { signToken, TOKEN_TTL_SEC, verifyToken } from '../src/lib/internal-token';
import { beat, fail, fresh, finish, MAX_ATTEMPTS, publishable, retry, start, STALE_MS, sweep, uploaded, type Job } from '../src/lib/video-job';

const queued = (): Job => uploaded(fresh());

describe('影片工作狀態機', () => {
  it('正常流程：上傳中 → 排隊 → 進行中 → 完成', () => {
    let j = fresh(); expect(j.status).toBe('uploading');
    j = uploaded(j); j = start(j, 100); expect(j).toMatchObject({ status: 'running', attempts: 1, startedAt: 100 });
    j = finish(j, 200); expect(j).toMatchObject({ status: 'done', finishedAt: 200 });
    expect(publishable(j)).toBe(true);
  });
  it('失敗會自動重試：前兩次回到排隊並留下原因，第三次才真的失敗', () => {
    let j = start(queued(), 1);
    j = fail(j, '503', 2); expect(j).toMatchObject({ status: 'queued', attempts: 1, error: '503' });
    expect(start(j, 3).error).toBe('503'); // 重試開始後仍看得到上一次的原因
    j = fail(start(j, 3), 'oom', 4); expect(j).toMatchObject({ status: 'queued', attempts: 2 });
    j = fail(start(j, 5), 'bad file', 6);
    expect(j).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, error: 'bad file', finishedAt: 6 });
    expect(publishable(j)).toBe(false);
  });
  it('「重新轉碼」只給失敗的，次數歸零', () => {
    const failed = { ...queued(), status: 'failed' as const, attempts: 3, error: 'x' };
    expect(retry(failed)).toMatchObject({ status: 'queued', attempts: 0, error: null });
    expect(() => retry(queued())).toThrow(/只有失敗/);
  });
  it('冪等：重複回報成功／失敗，或看門狗已收掉之後才回報，狀態不變', () => {
    const done = finish(start(queued(), 1), 2);
    expect(finish(done, 99)).toEqual(done);
    expect(fail(done, 'late', 99)).toEqual(done);
    const queuedAgain = fail(start(queued(), 1), 'x', 2);
    expect(finish(queuedAgain, 3)).toEqual(queuedAgain); // 已回到排隊，晚到的「成功」不能把它標成完成
  });
  it('看門狗：進行中太久沒有任何消息（沒有心跳）→ 當成失敗（走重試規則）', () => {
    const j = start(queued(), 1000);
    expect(sweep(j, 1000 + STALE_MS)).toEqual(j);
    expect(sweep(j, 1000 + STALE_MS + 1)).toMatchObject({ status: 'queued', error: '轉碼沒有回報（容器可能已經停了）' });
    expect(sweep(queued(), 1e12).status).toBe('queued'); // 沒在進行中的不動
  });
  it('看門狗：轉得很久但一直有心跳 → 不動（先前固定 30 分鐘，長影片永遠轉不完）', () => {
    let j = start(queued(), 0);
    for (let t = 5 * 60_000; t <= 3 * 60 * 60_000; t += 5 * 60_000) { j = beat(j, t); expect(sweep(j, t + 60_000)).toEqual(j); }
    expect(sweep(j, j.heartbeatAt! + STALE_MS + 1).status).toBe('queued');
  });
  it('心跳只對進行中的工作有效', () => expect(beat(queued(), 5)).toEqual(queued()));
  it('錯誤的狀態不能亂轉', () => {
    expect(() => start(fresh(), 1)).toThrow(); expect(() => uploaded(queued())).toThrow();
  });
  it('還沒轉好（上傳中、排隊、進行中、失敗）都不能發佈', () => {
    for (const j of [fresh(), queued(), start(queued(), 1), { ...queued(), status: 'failed' as const }]) expect(publishable(j)).toBe(false);
  });
});

describe('簽章網址', () => {
  const S = 'internal-secret';
  it('簽了就驗得過', async () => {
    const { exp, sig } = await signToken(S, '12', 'src', 1, 1000);
    expect(await verifyToken(S, '12', 'src', 1, String(exp), sig, 1000)).toEqual({ ok: true });
  });
  it('換一支影片、換一個動作都不行（偷到一個網址只能做它那一件事）', async () => {
    const { exp, sig } = await signToken(S, '12', 'src', 1, 1000);
    expect(await verifyToken(S, '13', 'src', 1, String(exp), sig, 1000)).toMatchObject({ ok: false, reason: '簽章不符' });
    expect(await verifyToken(S, '12', 'out', 1, String(exp), sig, 1000)).toMatchObject({ ok: false, reason: '簽章不符' });
    expect(await verifyToken(S, '12', 'done', 1, String(exp), sig, 1000)).toMatchObject({ ok: false });
  });
  it('過期：剛好到期還行，多一秒就不行', async () => {
    const { exp, sig } = await signToken(S, '12', 'out', 1, 1000, 60);
    expect((await verifyToken(S, '12', 'out', 1, String(exp), sig, 1060)).ok).toBe(true);
    expect(await verifyToken(S, '12', 'out', 1, String(exp), sig, 1061)).toMatchObject({ ok: false, reason: '網址已過期' });
  });
  it('把 exp 改長（想延長有效期）會簽章不符', async () => {
    const { exp, sig } = await signToken(S, '12', 'out', 1, 1000, 60);
    expect(await verifyToken(S, '12', 'out', 1, String(exp + 9999), sig, 1061)).toMatchObject({ ok: false, reason: '簽章不符' });
  });
  it.each([[null, null], ['abc', 'x'], ['1', 'a'.repeat(63)]])('格式不對 %j %j', async (e, s) => expect(await verifyToken(S, '1', 'src', 1, e, s, 0)).toMatchObject({ ok: false, reason: '簽章格式不對' }));
  it('伺服器沒設金鑰 → 一律拒絕', async () => {
    expect((await verifyToken('', '1', 'src', 1, '9999999999', 'a'.repeat(64), 0)).ok).toBe(false);
    await expect(signToken('', '1', 'src', 1)).rejects.toThrow();
  });
  it('綁定第幾次嘗試：重試之後，上一次的網址就不能回報或寫成品（舊容器不能蓋掉新的那次）', async () => {
    const { exp, sig } = await signToken(S, '12', 'done', 1, 1000);
    expect((await verifyToken(S, '12', 'done', 1, String(exp), sig, 1000)).ok).toBe(true);
    expect(await verifyToken(S, '12', 'done', 2, String(exp), sig, 1000)).toMatchObject({ ok: false, reason: '簽章不符' });
  });
  it('有效期是數小時（長影片轉得久）', () => expect(TOKEN_TTL_SEC).toBeGreaterThanOrEqual(3 * 3600));
});
