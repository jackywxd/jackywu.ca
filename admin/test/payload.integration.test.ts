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
  it('owner 看得到全部（含草稿）', async () => {
    const r = await t.payload.find({ collection: 'tales', overrideAccess: false, user: as('owner'), draft: true, limit: 50 });
    expect(r.docs.map((d) => d.slug).sort()).toEqual(['half', 'snow-day']);
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
