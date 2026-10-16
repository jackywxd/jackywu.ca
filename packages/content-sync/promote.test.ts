import { describe, expect, it } from 'vitest';
import { allowedKey, planPromote, planRevoke } from './promote';

const s = (...k: string[]) => new Set(k);

describe('allowedKey', () => {
  it.each(['video/a/1080p.mp4', 'gpx/x.gpx'])('接受 %s', (k) => expect(allowedKey(k)).toBe(true));
  it.each(['img/a.jpg', 'trash/x', '../video/a', 'video/../x', 'video//a', 'video/a b', 'video/*', 'video/', '', 'videos/a'])(
    '拒絕 %j', (k) => expect(allowedKey(k)).toBe(false));
});

describe('planPromote', () => {
  it('只複製公開端還沒有的', () => {
    const p = planPromote({ manifest: ['video/a/1080p.mp4', 'video/b/1080p.mp4'], privateKeys: s('video/a/1080p.mp4', 'video/b/1080p.mp4'), publicKeys: s('video/a/1080p.mp4') });
    expect(p).toEqual({ copy: ['video/b/1080p.mp4'], alreadyPublic: ['video/a/1080p.mp4'], missing: [] });
  });
  it('私有端也沒有 → missing（呼叫端要中止）', () => {
    expect(planPromote({ manifest: ['video/x/1080p.mp4'], privateKeys: s(), publicKeys: s() }).missing).toEqual(['video/x/1080p.mp4']);
  });
  it('manifest 含不允許的前綴 → throw，一個都不複製', () => {
    expect(() => planPromote({ manifest: ['video/a/1080p.mp4', 'img/secret.jpg'], privateKeys: s('img/secret.jpg'), publicKeys: s() })).toThrow(/不允許公開/);
  });
  it('重複的 key 只算一次', () => {
    expect(planPromote({ manifest: ['gpx/a.gpx', 'gpx/a.gpx'], privateKeys: s('gpx/a.gpx'), publicKeys: s() }).copy).toEqual(['gpx/a.gpx']);
  });
  it('不改動輸入', () => {
    const m = ['gpx/b.gpx', 'gpx/a.gpx'];
    planPromote({ manifest: m, privateKeys: s('gpx/a.gpx', 'gpx/b.gpx'), publicKeys: s() });
    expect(m).toEqual(['gpx/b.gpx', 'gpx/a.gpx']);
  });
});

describe('planRevoke', () => {
  const manifest = s(...Array.from({ length: 10 }, (_, i) => `video/v${i}/1080p.mp4`));
  it('撤 promoted 裡、manifest 不再引用、公開端還在的', () => {
    const r = planRevoke({ promoted: s('video/v1/1080p.mp4', 'video/old/1080p.mp4'), manifest, publicKeys: s('video/old/1080p.mp4', 'video/v1/1080p.mp4') });
    expect(r).toEqual({ ok: true, keys: ['video/old/1080p.mp4'] });
  });
  it('不在 promoted 的永遠不會被列入（不碰別人的東西）', () => {
    const r = planRevoke({ promoted: s(), manifest, publicKeys: s('video/stranger/1080p.mp4') });
    expect(r).toEqual({ ok: true, keys: [] });
  });
  it('公開端已經沒有的不重複刪', () => {
    expect(planRevoke({ promoted: s('video/gone/1080p.mp4'), manifest, publicKeys: s() })).toEqual({ ok: true, keys: [] });
  });
  const many = (n: number, p = 'old') => Array.from({ length: n }, (_, i) => `video/${p}${i}/1080p.mp4`);
  it('一次撤回超過已 promote 總數的 20% → 中止並說明', () => {
    const promoted = s(...many(30));
    const r = planRevoke({ promoted, manifest: s(...many(20)), publicKeys: promoted });
    expect(r.ok).toBe(false);
    expect(r.keys).toHaveLength(10);
  });
  it('媒體還少的時候，撤下一支影片（mp4＋poster 兩個 key）不會被比例擋住', () => {
    // 先前以「新 manifest 的 20%」計算，key 少於 10 個時每次撤下影片都會中止，孤兒永遠留在公開端
    const promoted = s('video/a/1080p.mp4', 'video/a/poster.jpg', 'gpx/x.gpx');
    expect(planRevoke({ promoted, manifest: s('gpx/x.gpx'), publicKeys: promoted })).toEqual({ ok: true, keys: ['video/a/1080p.mp4', 'video/a/poster.jpg'] });
  });
  it('新 manifest 是空的不是豁免：拉到半截資料時正是這種情況', () => {
    const promoted = s(...many(30));
    expect(planRevoke({ promoted, manifest: s(), publicKeys: promoted }).ok).toBe(false);
  });
  it('promoted 裡混進不允許的前綴也不會被刪', () => {
    const r = planRevoke({ promoted: s('img/a.jpg'), manifest, publicKeys: s('img/a.jpg') });
    expect(r).toEqual({ ok: true, keys: [] });
  });
});
