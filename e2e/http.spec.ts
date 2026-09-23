import { test, expect } from '@playwright/test';
import { FIXTURE, MANUAL } from './fixtures';

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

test('凡例把每個元件都畫出來了 @smoke', async ({ request }) => {
  /**
   * 凡例是站上唯一一頁把五個元件都實際跑一次的地方 —— 它存在的理由就是
   * 「元件壞了要看得見」。這一支盯著那個理由還成立。
   *
   * **不是**防「版型漏掉 components 註冊表」：那個情況 build 會直接失敗
   * （Expected component `Route` to be defined），實測過，輪不到測試。
   *
   * 防的是 build 抓不到、頁面照樣 200 的那一類：有人改凡例時順手刪掉了範例，
   * 或某個元件變成渲染出空白。造過：把最後一個活的 <Route> 從 manual.mdx 拿掉
   * → build 成功、108 頁照舊，figure.route 從 4 掉到 3，這支紅。
   *
   * 放在 HTTP 層不是瀏覽器層：元件是伺服器端渲染的靜態標記，開瀏覽器觀察不到
   * 更多東西，只會慢十倍。
   */
  const html = await (await request.get(MANUAL.path)).text();
  const count = (re: RegExp) => html.match(re)?.length ?? 0;

  expect(count(/<figure class="route"/g), `凡例上的 <Route> 少了 —— 範例被刪掉，或元件渲染成空白`)
    .toBe(MANUAL.routes);
  expect(count(/<video/g), '凡例上的 <Video> 不見了').toBeGreaterThan(0);
  expect(count(/<picture/g), '凡例上的 <Figure>/<Gallery> 不見了').toBeGreaterThan(0);
  expect(html, '凡例上的 <MissingImage> 不見了').toContain('闕');

  // 中文粗體的坑：句號包在 ** 裡面就不閉合，渲染後會留下字面的 **。
  // 造過：把一處改回 **…。** → 這條紅。只看正文，程式碼區塊裡的 ** 是刻意的示範。
  const body = html.slice(html.indexOf('class="scroll"'));
  const literal = body.replace(/<code[\s\S]*?<\/code>/g, '').match(/\*\*/g)?.length ?? 0;
  expect(literal, '凡例正文裡有沒有生效的 ** —— 句號包在粗體裡了，見 docs/gotchas.md').toBe(0);
});
