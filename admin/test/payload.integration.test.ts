import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPayload, hdr } from './helpers/payload';

let t: Awaited<ReturnType<typeof bootPayload>>;
beforeAll(async () => { t = await bootPayload(); });
afterAll(async () => { await t?.close(); });

const goodTale = {
  title: '雪山上的一天', slug: 'snow-day', date: '2026-01-15', realm: 'snow' as const,
  excerpt: '在雪山上走了一整天，風很大，人很少，回來之後什麼都記得。',
};

describe('從空庫套用全部 migrations', () => {
  it('每個集合都有表，且一開始是空的', async () => {
    for (const c of ['tales', 'pages', 'routes', 'reels', 'media', 'redirects', 'publish-requests', 'promoted'] as const) {
      const r = await t.payload.find({ collection: c, limit: 1, overrideAccess: true });
      expect(r.totalDocs, c).toBe(0);
    }
  });
  it('測試用的暫存目錄確實存在（證明沒有借用開發狀態）', () => {
    expect(existsSync(t.dir)).toBe(true);
    expect(t.dir).toMatch(/hongchen-admin-test-/);
  });
});

describe('Access 驗證策略', () => {
  it('沒有 JWT、不是 localhost → 匿名（user = null），不是放行', async () => {
    // 先關掉 bypass，模擬正式環境
    const saved = process.env.ADMIN_DEV_BYPASS_EMAIL;
    delete process.env.ADMIN_DEV_BYPASS_EMAIL;
    try {
      const r = await t.payload.auth({ headers: hdr('admin.jackywu.ca') });
      expect(r.user).toBeNull();
    } finally { process.env.ADMIN_DEV_BYPASS_EMAIL = saved; }
  });
  it('localhost + bypass → owner，並自動建立使用者', async () => {
    const r = await t.payload.auth({ headers: hdr('localhost:3000') });
    expect(r.user).toMatchObject({ email: 'me@example.com', role: 'owner' });
    const n = await t.payload.count({ collection: 'users', overrideAccess: true });
    expect(n.totalDocs).toBe(1);
    await t.payload.auth({ headers: hdr('localhost:3000') });
    expect((await t.payload.count({ collection: 'users', overrideAccess: true })).totalDocs).toBe(1);
  });
  it('跨站送來的寫入請求 → 匿名（CSRF）；同源的照常是 owner', async () => {
    const { accessStrategy } = await import('../src/lib/access-strategy');
    const run = (headers: Headers) => accessStrategy.authenticate({ payload: t.payload, headers, req: { method: 'POST', headers } as never });
    expect((await run(hdr('localhost:3000', { 'sec-fetch-site': 'cross-site' }))).user).toBeNull();
    expect((await run(hdr('localhost:3000', { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000' }))).user).toMatchObject({ role: 'owner' });
  });
  it('bypass 不信 x-forwarded-host（用戶端自己就能帶這個 header）', async () => {
    const r = await t.payload.auth({ headers: hdr('admin.jackywu.ca', { 'x-forwarded-host': 'localhost' }) });
    expect(r.user).toBeNull();
  });
  it('bypass 出現在 admin.jackywu.ca → 一律拒絕（Payload 會記錄錯誤並當匿名）', async () => {
    // 設定事故在 access-jwt 單元測試裡斷言會 throw；Payload 接住策略的例外並回匿名，
    // 這裡斷言的是「最終結果」：絕對不是放行。
    const r = await t.payload.auth({ headers: hdr('admin.jackywu.ca') });
    expect(r.user).toBeNull();
  });
});

describe('草稿與發佈驗證', () => {
  it('草稿可以只寫一半（不擋）', async () => {
    const d = await t.payload.create({
      collection: 'tales', draft: true, overrideAccess: true,
      data: { title: 'x', slug: 'half', date: '2026-01-01', realm: 'run', excerpt: 'x' },
    });
    expect(d._status).toBe('draft');
  });
  it('發佈時所有不合格的欄位一次列出，且指向欄位', async () => {
    const err = await t.payload.create({
      collection: 'tales', overrideAccess: true,
      data: { ...goodTale, slug: 'bad-pub', realm: 'still', shareable: true, hero: undefined, _status: 'published' },
    }).catch((e) => e);
    expect(err.name).toBe('ValidationError');
    expect(err.data.errors.map((e: { path: string }) => e.path)).toContain('shareable');
  });
  it('發佈合格的文章成功', async () => {
    const d = await t.payload.create({
      collection: 'tales', overrideAccess: true, data: { ...goodTale, _status: 'published' },
    });
    expect(d._status).toBe('published');
  });
  it('slug 全站唯一', async () => {
    await expect(
      t.payload.create({ collection: 'tales', overrideAccess: true, data: { ...goodTale, _status: 'published' } }),
    ).rejects.toBeTruthy();
  });
});

describe('存取控制（overrideAccess: false）', () => {
  const as = (role: 'owner' | 'reader' | null) => role && ({ id: 1, role, collection: 'users' } as never);

  it('匿名什麼都讀不到、也寫不了', async () => {
    await expect(t.payload.find({ collection: 'tales', overrideAccess: false })).rejects.toMatchObject({ status: 403 });
    await expect(
      t.payload.create({ collection: 'tales', overrideAccess: false, data: { ...goodTale, slug: 'anon' } }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('reader 只看得到已發佈的，看不到草稿', async () => {
    const r = await t.payload.find({ collection: 'tales', overrideAccess: false, user: as('reader'), limit: 50 });
    expect(r.docs.map((d) => d.slug)).toEqual(['snow-day']);
  });
  it('reader 不能寫', async () => {
    await expect(
      t.payload.create({ collection: 'tales', overrideAccess: false, user: as('reader'), data: { ...goodTale, slug: 'r' } }),
    ).rejects.toBeTruthy();
  });
  it('reader 讀不到任何版本（草稿全文在版本表裡）：建置要的內容由發佈請求的快照提供', async () => {
    const reader = { overrideAccess: false, user: as('reader'), limit: 100 } as const;
    for (const collection of ['tales', 'pages', 'routes', 'reels'] as const) {
      await expect(t.payload.findVersions({ collection, ...reader })).rejects.toMatchObject({ status: 403 });
    }
  });
  it('owner 看得到全部版本', async () => {
    const r = await t.payload.findVersions({ collection: 'tales', overrideAccess: false, user: as('owner'), limit: 100 });
    expect(r.docs.length).toBeGreaterThan(0);
  });
  it('owner 看得到全部（含草稿）', async () => {
    const r = await t.payload.find({ collection: 'tales', overrideAccess: false, user: as('owner'), draft: true, limit: 50 });
    expect(r.docs.map((d) => d.slug).sort()).toEqual(['half', 'snow-day']);
  });
});

describe('媒體的讀取：CI（reader）只拿得到建置需要的', () => {
  const as = (role: 'owner' | 'reader') => ({ id: 1, role, collection: 'users' } as never);
  it('只被草稿用到的圖 → reader 讀不到；已上線文章用的、或正在建置的那一筆用的 → 讀得到', async () => {
    const sharp = (await import('sharp')).default;
    const img = async (alt: string, color: string) => t.payload.create({ collection: 'media', overrideAccess: true, data: { alt, kind: 'img' },
      file: { data: await sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).jpeg().toBuffer(), mimetype: 'image/jpeg', name: `${alt}.jpg`, size: 1 } });
    // 這個測試建的東西逐筆依 id 收掉：後面的測試假設媒體表是空的
    const made: { collection: 'media' | 'tales' | 'publish-requests'; id: string | number }[] = [];
    try {
    const [draftOnly, live, building] = [await img('draft-only', '#111'), await img('live-hero', '#222'), await img('building', '#333')];
    made.push(...[draftOnly, live, building].map((m) => ({ collection: 'media' as const, id: m.id })));
    const tale = async (slug: string, hero: unknown, status: 'draft' | 'published') => {
      const d = await t.payload.create({ collection: 'tales', overrideAccess: true, draft: status === 'draft',
        data: { title: slug, slug, date: '2026-03-01', realm: 'run', excerpt: '一段足夠長的摘要，讓它通過顯示寬度的下限檢查，也方便辨認這是哪一篇。', hero, heroAlt: 'a', _status: status } as never });
      made.push({ collection: 'tales', id: d.id });
    };
    await tale('media-draft', draftOnly.id, 'draft');
    await tale('media-live', live.id, 'published');
    const req = await t.payload.create({ collection: 'publish-requests', overrideAccess: true, data: {
      requestId: 'mediaaccess0000000000001', kind: 'publish', collectionSlug: 'tales', docId: '999', versionId: '1', status: 'dispatched', createdAtMs: Date.now(),
      snapshot: { doc: { collection: 'tales', id: 999, versionId: '1', data: { id: 999, hero: building.id } }, deps: [], takenAt: new Date().toISOString() },
    } as never });
    made.push({ collection: 'publish-requests', id: req.id });
    {
      const seen = (await t.payload.find({ collection: 'media', overrideAccess: false, user: as('reader'), limit: 100, depth: 0 })).docs.map((d) => d.alt);
      expect(seen).toContain('live-hero');
      expect(seen).toContain('building');
      expect(seen).not.toContain('draft-only');
      expect((await t.payload.find({ collection: 'media', overrideAccess: false, user: as('owner'), limit: 100 })).docs.map((d) => d.alt)).toContain('draft-only');
    }
    } finally {
      for (const m of made.reverse()) await t.payload.delete({ collection: m.collection, id: m.id, overrideAccess: true });
    }
  });
});

describe('路線的 SVG 不能經由 API 寫入（前台會直接嵌進頁面）', () => {
  it('本人經由 API 送來的 svgTrack 被丟掉；GPX 匯入（overrideAccess）照常能寫', async () => {
    const owner = { id: 1, role: 'owner', collection: 'users' } as never;
    const r = await t.payload.create({ collection: 'routes', overrideAccess: false, user: owner, draft: true,
      data: { name: 'svg', slug: 'svg-api', realm: 'run', date: '2026-01-01', region: 'r', svgTrack: '<svg><script>alert(1)</script></svg>' } as never });
    const got = await t.payload.findByID({ collection: 'routes', id: r.id, draft: true, overrideAccess: true, depth: 0 }) as { svgTrack?: string | null };
    expect(got.svgTrack ?? null).toBeNull();
    await t.payload.update({ collection: 'routes', id: r.id, draft: true, overrideAccess: true, data: { svgTrack: '<svg/>' } as never });
    expect((await t.payload.findByID({ collection: 'routes', id: r.id, draft: true, overrideAccess: true, depth: 0 }) as { svgTrack?: string }).svgTrack).toBe('<svg/>');
    await t.payload.delete({ collection: 'routes', id: r.id, overrideAccess: true });
  });
});

describe('與前台 schema 一致的欄位規則', () => {
  it('路線距離 0 → 拒收（前台要求正數，0 會在建置時才失敗）', async () => {
    await expect(t.payload.create({ collection: 'routes', overrideAccess: true, data: { name: 'x', slug: 'zero-km', realm: 'run', date: '2026-01-01', region: 'r', distanceKm: 0 } as never }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('改 slug 自動記 301', () => {
  it('已發佈的文章改 slug → redirects 多一筆，且不含空白', async () => {
    const d = await t.payload.create({
      collection: 'tales', overrideAccess: true, data: { ...goodTale, slug: 'before-rename', _status: 'published' },
    });
    await t.payload.update({ collection: 'tales', id: d.id, overrideAccess: true, data: { slug: 'after-rename', _status: 'published' } });
    const r = await t.payload.find({ collection: 'redirects', overrideAccess: true, where: { from: { equals: '/tales/2026/before-rename/' } } });
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0]!.to).toBe('/tales/2026/after-rename/');
  });
  it('redirects 的欄位拒絕含空白的網址', async () => {
    await expect(
      t.payload.create({ collection: 'redirects', overrideAccess: true, data: { from: '/a b/', to: '/c/' } }),
    ).rejects.toBeTruthy();
  });
});

describe('媒體上傳：伺服器端擋 GPS', () => {
  const gps = { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 17/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '123/1 7/1 0/1' } };
  const file = (data: Buffer, name = 'a.jpg', mimetype = 'image/jpeg') => ({ data, name, mimetype, size: data.length });
  it('帶 GPS 的 JPEG → 拒收，而且訊息說明原因', async () => {
    const sharp = (await import('sharp')).default;
    const buf = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#789' } }).withExif(gps).jpeg().toBuffer();
    const err = await t.payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'x', kind: 'img' }, file: file(buf) }).catch((e) => e);
    expect(String(err.message)).toMatch(/GPS/);
    expect((await t.payload.count({ collection: 'media', overrideAccess: true })).totalDocs).toBe(0);
  });
  it('沒有 GPS 的 JPEG → 收下', async () => {
    const sharp = (await import('sharp')).default;
    const buf = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#789' } }).jpeg().toBuffer();
    const d = await t.payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'ok', kind: 'img' }, file: file(buf, 'ok.jpg') });
    expect(d.alt).toBe('ok');
  });
  it('壞掉的 JPEG → 拒收', async () => {
    const err = await t.payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'bad', kind: 'img' }, file: file(Buffer.from([0xff, 0xd8, 1, 2, 3, 4, 5, 6])) }).catch((e) => e);
    expect(err).toBeInstanceOf(Error); // Payload 自己的檔案類型偵測先擋下；我們的 unreadable 檢查是第二道
  });
  it('PNG／WebP：沒有 GPS 收下，帶 GPS 拒收', async () => {
    const sharp = (await import('sharp')).default;
    const mk = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#789' } });
    const png = await mk().png().toBuffer(), pngGps = await mk().withExif(gps).png().toBuffer();
    const webpGps = await mk().withExif(gps).webp().toBuffer();
    expect((await t.payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'png', kind: 'img' }, file: file(png, 'a.png', 'image/png') })).alt).toBe('png');
    for (const [buf, name, mime] of [[pngGps, 'g.png', 'image/png'], [webpGps, 'g.webp', 'image/webp']] as const) {
      const err = await t.payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'g', kind: 'img' }, file: file(buf, name, mime) }).catch((e) => e);
      expect(String(err.message), name).toMatch(/GPS/);
    }
  });
  it('AVIF 不在允許清單', async () => {
    await expect(t.payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'x', kind: 'img' }, file: file(Buffer.from('....ftypavif'), 'a.avif', 'image/avif') })).rejects.toBeTruthy();
  });
});

describe('自訂端點的路徑', () => {
  it('不與任何集合的 REST 路由衝突（/<集合 slug>/… 會被 Payload 當成該集合的文件路由，回 404）', () => {
    const slugs = t.payload.config.collections.map((c) => c.slug);
    for (const e of t.payload.config.endpoints ?? []) {
      const first = e.path.split('/').filter(Boolean)[0];
      expect(slugs, `端點 ${e.method} ${e.path} 與集合「${first}」衝突`).not.toContain(first);
    }
  });
});
