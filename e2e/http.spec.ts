import { test, expect } from '@playwright/test';
import { FIXTURE } from './fixtures';

/**
 * HTTP 層：不需要瀏覽器，用 request fixture。驗的是 public/_headers 與 wrangler.jsonc 的
 * not_found_handling 被 Workers 真的套用了 —— 兩邊都跑：CI 對 wrangler dev，上線後對 jackywu.ca。
 *
 * 每一支都在原始碼裡造過故障、看它為那個理由紅過（見各自的註解）。
 *
 * 舊站轉址（_redirects）不在這裡：格式錯（網址含真空白）CI 的產物斷言已經先擋，
 * 目標不存在由 verify-links 擋 —— 在 wrangler dev 上再驗一次沒有多抓到任何東西。
 * 它只在部署後有意義，見 deployed.spec.ts。
 */

test('HTML 帶 CSP，且允許搜尋需要的 wasm @smoke', async ({ request }) => {
  // 造過：_headers 的 script-src 少了 'wasm-unsafe-eval' → 這支紅，search.spec 也紅
  const csp = (await request.get(FIXTURE.path)).headers()['content-security-policy'] ?? '';
  expect(csp, '頁面沒有 Content-Security-Policy —— _headers 的 /* 規則沒生效').toContain("default-src 'self'");
  expect(csp, "CSP 少了 'wasm-unsafe-eval'，搜尋的 wasm 會被擋").toContain("'wasm-unsafe-eval'");
});

test('文章頁不被長快取 @smoke', async ({ request }) => {
  // 造過：_headers 加一條 /tales/* 的 max-age=3600 → 紅。部署後讀者會看到舊版。
  // 注意：_headers 的 /*.html 規則只對到字面上的 …/index.html，讀者用的漂亮網址不經過它；
  // 這裡的 max-age=0 其實是 Workers 對 HTML 的預設。改那條規則，這支不會紅 —— 造過。
  const cc = (await request.get(FIXTURE.path)).headers()['cache-control'];
  expect(cc, `文章頁的 Cache-Control 是「${cc}」—— 有規則給 HTML 加了長快取`).toBe('public, max-age=0, must-revalidate');
});

test('內容雜湊過的資產永久快取 @smoke', async ({ request }) => {
  // 造過：拿掉 _headers 的 /_astro/* 規則 → 紅。每次造訪都重新下載 CSS/JS。
  const html = await (await request.get('/')).text();
  const asset = html.match(/\/_astro\/[^"']+\.css/)?.[0];
  expect(asset, '首頁沒有引用任何 /_astro/*.css').toBeTruthy();
  const cc = (await request.get(asset!)).headers()['cache-control'];
  expect(cc, `${asset} 的 Cache-Control 是「${cc}」—— _headers 的 /_astro/* 規則沒生效`).toBe(
    'public, max-age=31536000, immutable',
  );
});

test('不存在的網址回 404，而不是 200 @smoke', async ({ request }) => {
  // 造過：wrangler.jsonc 的 not_found_handling 改成 single-page-application → 紅。
  // 死連結回 200 的話，搜尋引擎會把它們全部收錄成重複頁。
  const res = await request.get(`/no-such-page-${Date.now()}/`);
  expect(res.status(), '不存在的網址沒有回 404 —— 檢查 wrangler.jsonc 的 not_found_handling').toBe(404);
  expect(await res.text(), '404 回的不是站上的 404 頁').toContain('紅塵客棧');
});
