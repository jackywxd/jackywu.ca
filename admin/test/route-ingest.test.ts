import { describe, expect, it } from 'vitest';
import { prepareRoute } from '../src/lib/route-ingest';

const GPX = `<gpx><trk><name>Loop</name><trkseg>${Array.from({ length: 50 }, (_, i) => `<trkpt lat="${49 + i * 0.002}" lon="${-123 + i * 0.003}"><ele>${100 + i * 4}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
const ok = { slug: 'loop-50', name: ' 環線 ', realm: 'run', region: '卑詩', date: '2026-08-22' };

describe('prepareRoute', () => {
  it('合格：算出距離與爬升，名稱去掉頭尾空白，選填欄位是 null', () => {
    const r = prepareRoute(ok, GPX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ name: '環線', slug: 'loop-50', realm: 'run', nameEn: null, badge: null, downloadable: true });
    expect(r.stats.distanceKm).toBeGreaterThan(0);
    expect(r.stats.gainM).toBeGreaterThan(150);
    expect(String(r.data.svgProfile)).toContain('<svg');
  });
  it('所有欄位問題一次列出，每個都指向欄位', () => {
    const r = prepareRoute({ slug: 'Bad Slug', realm: 'forge', date: '2026-02-30', elapsed: '21h', note: 'x'.repeat(201) }, GPX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field).sort()).toEqual(['date', 'elapsed', 'name', 'note', 'realm', 'region', 'slug']);
  });
  it('FIT 帶來的移動時間與開始時間：格式對就存，選填', () => {
    const r = prepareRoute({ ...ok, movingTime: 'PT2H31M5S', startedAt: '2026-08-16T06:05-07:00' }, GPX);
    expect(r.ok && [r.data.movingTime, r.data.startedAt]).toEqual(['PT2H31M5S', '2026-08-16T06:05-07:00']);
    expect(prepareRoute(ok, GPX).ok && (prepareRoute(ok, GPX) as { data: Record<string, unknown> }).data.movingTime).toBeNull();
  });
  it('移動時間不是 ISO 8601、開始時間沒有時區或不是真的時間 → 指向那個欄位', () => {
    for (const [movingTime, startedAt] of [['2:31', '2026-08-16T06:05-07:00'], ['PT2H', '2026-08-16T06:05'], ['PT2H', '2026-08-16T25:05-07:00'], ['PT2H', '2026-02-30T06:05-07:00']] as const) {
      const r = prepareRoute({ ...ok, movingTime, startedAt }, GPX);
      expect(r.ok, `${movingTime} ${startedAt}`).toBe(false);
      expect(r.ok === false && r.errors.map((e) => e.field)).toEqual([movingTime === '2:31' ? 'movingTime' : 'startedAt']);
    }
  });
  it('realm 只收四個行當（forge、still 不能有路線）', () => {
    expect(prepareRoute({ ...ok, realm: 'still' }, GPX).ok).toBe(false);
  });
  it('GPX 壞掉或點太少 → gpx 欄位錯誤，訊息可讀', () => {
    const r = prepareRoute(ok, '<gpx></gpx>');
    expect(r.ok === false && r.errors).toEqual([{ field: 'gpx', message: expect.stringContaining('至少需要 2 個') }]);
  });
  it('GPX 太大 → 在解析之前就擋下', () => {
    const r = prepareRoute(ok, 'x'.repeat(21 * 1024 * 1024));
    expect(r.ok === false && r.errors[0]).toMatchObject({ field: 'gpx', message: expect.stringContaining('太大') });
  });
  it('沒有高程 → 爬升是 null，仍然能建立', () => {
    const noEle = GPX.replace(/<ele>[^<]*<\/ele>/g, '');
    const r = prepareRoute(ok, noEle);
    expect(r.ok && r.stats.gainM).toBeNull();
  });
});
