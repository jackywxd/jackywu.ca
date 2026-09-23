import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FIXTURE, LEGACY_REDIRECT } from './fixtures';
import { BUDGET } from './budgets';

/**
 * 只有部署後才看得到的東西。只在 prod project 跑（CI 的 wrangler dev 上沒有意義）。
 */

test('線上跑的是這次建置的產物 @live-build', async ({ request }, testInfo) => {
  // 測試本身的逾時（預設 30s）必須大於輪詢預算，否則預算永遠輪不到生效
  test.setTimeout(BUDGET.deployPropagation + 15_000);
  // 防：部署「成功」但線上仍是舊版（部署到錯的 Worker、邊緣快取、上傳一半）。
  // Actions 綠燈只證明指令跑完，不證明讀者拿到的是這一版。
  // 比對的是內容雜湊過的資產檔名：同一份原始碼才會產生同一組雜湊。
  const built = readFileSync('dist/index.html', 'utf8');
  const assets = [...new Set(built.match(/\/_astro\/[^"']+\.(?:css|js)/g) ?? [])];
  expect(assets.length, 'dist/index.html 沒有任何 /_astro 資產 —— 沒先建置？').toBeGreaterThan(0);

  const t0 = Date.now();
  await expect
    .poll(
      async () => {
        const live = await (await request.get(`/?smoke=${Date.now()}`)).text();
        return assets.filter((a) => !live.includes(a));
      },
      { message: '線上首頁缺少這次建置的資產', timeout: BUDGET.deployPropagation, intervals: [2_000] },
    )
    .toEqual([]);
  testInfo.annotations.push({ type: 'propagation-ms', description: String(Date.now() - t0) });
});

test('www 301 到 apex @deployed', async ({ request }) => {
  // wrangler.jsonc 的設計：www 與 apex 都綁上 Worker，www → apex 由 zone 的 Redirect Rule 做。
  // 防：規則不見了，全站以兩個主機名各服務一份。
  const res = await request.get(`https://www.jackywu.ca${FIXTURE.path}`, { maxRedirects: 0 });
  expect(res.status(), `www.jackywu.ca 回 ${res.status()} 而不是 301 —— zone 的 www → apex Redirect Rule 不在`).toBe(301);
  expect(res.headers()['location'], 'www 轉到了別的地方').toBe(`https://jackywu.ca${FIXTURE.path}`);
});

test('文章裡的影片能從 R2 分段取得 @deployed', async ({ request }) => {
  // 防：R2 物件被刪、自訂網域或 CORS/Range 設定壞掉 —— 頁面照常，只有按下播放才發現。
  // 需要 206：<video> 靠 Range 請求才能拖曳進度與串流播放。
  // 造過：頁面指向 R2 上不存在的 key → 404，紅。
  const html = await (await request.get(FIXTURE.path)).text();
  const src = html.match(/https:\/\/media\.jackywu\.ca\/[^"' ]+\.mp4/)?.[0];
  expect(src, '範例文章裡找不到 media.jackywu.ca 的影片').toBeTruthy();
  const res = await request.get(src!, { headers: { Range: 'bytes=0-1023' } });
  expect(res.status(), `${src} 沒有回 206 —— 物件不在 R2，或不支援 Range`).toBe(206);
  expect(res.headers()['content-type'], `${src} 的 Content-Type 不是 video/mp4`).toBe('video/mp4');
});

test('舊站網址在線上真的 301 @deployed', async ({ request }) => {
  // 格式與目標在 CI 已經驗過（產物斷言、verify-links）。這裡驗的是部署出去的 Worker 與 zone
  // 真的套用了 _redirects —— zone 的規則、Workers 的上限都只有線上才有。
  // 造過：同一個斷言在 wrangler dev 上，把這行的 %20 改成真空白 → 紅。
  const res = await request.get(LEGACY_REDIRECT.from, { maxRedirects: 0 });
  expect(res.status(), `${LEGACY_REDIRECT.from} 沒有 301 —— 線上沒有套用 _redirects`).toBe(LEGACY_REDIRECT.status);
  expect(new URL(res.headers()['location']!, 'https://jackywu.ca').pathname).toBe(LEGACY_REDIRECT.to);
});
