import { test, expect } from '@playwright/test';
import { FIXTURE } from './fixtures';

/**
 * 旅程：讀者在文章底下按「分享 · 存圖」，看到海報，複製微信文案。
 *
 * 防的是兩件看不見的事（作者自己很少打開這個面板，壞了要等讀者分享出去才知道）。
 * 都在原始碼裡造過、看它紅過：
 *   1. 海報不載入：打開面板時把 data-src 搬進 src 的那一行不見了 → 「海報沒有載入」紅。
 *      海報網址本身錯了輪不到這裡：下載連結用同一個網址，postbuild 的 verify-links 會先擋。
 *   2. 微信文案沒有網址（src/lib/share.ts 掉了 url，或按鈕接錯欄位）→ 「沒有以正式網址結尾」紅。
 *
 * 為什麼要瀏覽器：延遲設 src、dialog、剪貼簿都是執行期行為。
 *
 * 不防 docs/gotchas.md 的「lazy 圖在 <dialog> 裡永遠不載入」：把元件退回修法前的寫法
 * （loading="lazy" + src）實測，Chromium 與 WebKit 打開後都載入 1080px。這支測試造不出那個故障，
 * 就不宣稱防它。
 */
test('打開分享面板：海報載入、微信文案帶正式網址', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(FIXTURE.path);

  await page.getByRole('button', { name: '分享 · 存圖' }).click();
  const sheet = page.getByRole('dialog', { name: `分享「${FIXTURE.title}」` });
  await expect(sheet).toBeVisible();

  const poster = sheet.getByRole('img', { name: `${FIXTURE.title} 的分享海報` });
  await expect
    .poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), {
      message: '海報沒有載入（naturalWidth 為 0）',
    })
    .toBeGreaterThan(0);

  const copy = sheet.getByRole('button', { name: '複製微信文案' });
  await copy.click();
  await expect(sheet.getByRole('button', { name: '已複製 ✓' }), '按了複製，按鈕沒有變成「已複製 ✓」—— 寫入剪貼簿失敗').toBeVisible();

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.startsWith(FIXTURE.title), `剪貼簿不是以標題開頭：${JSON.stringify(text)}`).toBe(true);
  expect(
    text.trimEnd().endsWith(`https://jackywu.ca${FIXTURE.path}`),
    `微信文案沒有以文章的正式網址結尾：${JSON.stringify(text)}`,
  ).toBe(true);

  await sheet.getByRole('button', { name: '關閉' }).click();
  await expect(sheet).toBeHidden();
});
