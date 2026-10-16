import { test, expect } from './fixtures';

/** 後台的頁面不能被別的網站用 iframe 框起來（誘騙本人點「發佈」「刪除」） */
test('頁面與 API 都帶防框架與基本的安全標頭', async ({ request }) => {
  for (const path of ['/tales', '/api/publish/status']) {
    const r = await request.get(path);
    const h = r.headers();
    expect(h['content-security-policy'] ?? '', path).toContain("frame-ancestors 'none'");
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['referrer-policy'], path).toBe('same-origin');
  }
});
