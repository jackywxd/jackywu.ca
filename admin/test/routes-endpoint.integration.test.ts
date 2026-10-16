import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PayloadRequest } from 'payload';
import { routeEndpoints } from '../src/endpoints/routes';
import { bindings } from '../src/lib/bindings';
import { bootPayload } from './helpers/payload';

let t: Awaited<ReturnType<typeof bootPayload>>;
beforeAll(async () => { t = await bootPayload(); });
afterAll(async () => { await t?.close(); });

const GPX = `<gpx><trk><name>Loop</name><trkseg>${Array.from({ length: 60 }, (_, i) => `<trkpt lat="${49 + i * 0.002}" lon="${-123 + i * 0.003}"><ele>${100 + i * 4}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
const handler = routeEndpoints[0]!.handler;
const owner = { id: 1, role: 'owner' };

async function post(fields: Record<string, string>, gpx: string | null = GPX, user: unknown = owner) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (gpx !== null) fd.set('gpx', new File([gpx], 'x.gpx', { type: 'application/gpx+xml' }));
  const req = Object.assign(new Request('http://localhost/api/ingest/gpx', { method: 'POST', body: fd }), { payload: t.payload, user }) as unknown as PayloadRequest;
  const res = await handler(req) as Response;
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const ok = { slug: 'ep-loop', name: '環線', realm: 'run', region: '卑詩', date: '2026-08-22' };

describe('POST /ingest/gpx', () => {
  it('匿名 → 401，什麼都沒寫', async () => {
    expect((await post(ok, GPX, null)).status).toBe(401);
    expect(await bindings().R2.head('gpx/ep-loop.gpx')).toBeNull();
  });
  it('欄位錯誤 → 422 與欄位，R2 與資料庫都沒有東西', async () => {
    const r = await post({ ...ok, slug: 'Bad Slug', realm: 'forge' });
    expect(r.status).toBe(422);
    expect((r.body.errors as { field: string }[]).map((e) => e.field).sort()).toEqual(['realm', 'slug']);
    expect((await t.payload.count({ collection: 'routes', overrideAccess: true })).totalDocs).toBe(0);
  });
  it('沒附 GPX → 422，gpx 欄位的錯誤與其他欄位的錯誤一次列出', async () => {
    const r = await post({ slug: 'Bad Slug' }, null);
    expect(r.status).toBe(422);
    expect((r.body.errors as { field: string }[]).map((e) => e.field).sort()).toEqual(['date', 'gpx', 'name', 'realm', 'region', 'slug']);
  });
  it('合格：建立草稿路線、算出數據、GPX 原檔進私有 bucket 的 gpx/<slug>.gpx', async () => {
    const r = await post(ok);
    expect(r.status).toBe(201);
    const doc = await t.payload.findByID({ collection: 'routes', id: r.body.id as number, draft: true, overrideAccess: true });
    expect(doc).toMatchObject({ slug: 'ep-loop', name: '環線', hasGpx: true, _status: 'draft', downloadable: true });
    expect(doc.distanceKm).toBeGreaterThan(0);
    expect(doc.svgProfile).toContain('<svg');
    const obj = await bindings().R2.get('gpx/ep-loop.gpx');
    expect(await obj!.text()).toBe(GPX);
  });
  it('slug 已被使用 → 422，且不覆蓋已經存在的 GPX 檔', async () => {
    const before = await (await bindings().R2.get('gpx/ep-loop.gpx'))!.text();
    const r = await post({ ...ok, name: '另一條' }, GPX.replace('49', '50'));
    expect(r.status).toBe(422);
    expect((r.body.errors as { field: string }[])[0]!.field).toBe('slug');
    expect(await (await bindings().R2.get('gpx/ep-loop.gpx'))!.text()).toBe(before);
  });
});
