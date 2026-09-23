import { test, expect } from '@playwright/test';

/**
 * 首頁時光機的捲動驅動動效，在「建置後的 CSS」上真的掛上了時間軸。
 *
 * 防的是：Lightning CSS 把 animation 簡寫與 animation-timeline 併成一條無效宣告，
 * 整條被丟棄，所有捲動動效在 production 靜默失效 —— dev 沒壓縮，看不出來
 * （docs/gotchas.md 第一條，真實事故）。
 *
 * 為什麼要瀏覽器：宣告「無效被丟棄」只有 CSS 引擎知道，grep 建置產物看不出來。
 * 判準直接取自那條 gotcha 的「怎麼確認修好了」。兩條都在原始碼裡造過、看它紅過：
 *   · motion.css 把 .spine-ink 寫回 animation 簡寫 → Lightning CSS 至今仍會合併 → 時間軸那一步紅
 *   · animation-duration 寫死成 1ms → duration 那一步紅
 */
test('時光機的動效掛在捲動時間軸上', async ({ page }) => {
  await page.goto('/');

  const timelines = await page.evaluate(() =>
    [...new Set(document.getAnimations().map((a) => a.timeline?.constructor?.name))],
  );
  expect(timelines, '捲動脊柱（scroll(root)）與逐項浮現（view()）兩種時間軸都要在').toEqual(
    expect.arrayContaining(['ScrollTimeline', 'ViewTimeline']),
  );

  // duration 寫死會讓元素停在結束幀（同一條 gotcha 的連帶坑）
  const spine = await page.locator('.spine-ink').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, duration: cs.animationDuration };
  });
  expect(spine.name, '.spine-ink 沒有掛上 spine-draw —— 宣告被丟棄了').toBe('spine-draw');
  expect(spine.duration, 'scroll-driven 的 animation-duration 必須是 auto，寫死時長會停在結束幀').toBe('auto');
});
