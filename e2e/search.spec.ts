import { test, expect } from '@playwright/test';
import { FIXTURE } from './fixtures';
import { BUDGET } from './budgets';

/**
 * 旅程：訪客打開「尋」，輸入標題，點進文章。
 *
 * 防的是搜尋在頁面看起來完全正常的情況下死掉。每一條都在原始碼裡造過、看它紅過：
 *   · 介面字串變簡體（拿掉 <pagefind-config lang="zh-tw">）          → 搜尋框那一步紅
 *   · 沒有索引（拿掉 astro-pagefind 整合）                          → 「沒有回應」那一步紅
 *   · wasm 被 CSP 擋（_headers 少了 'wasm-unsafe-eval'）            → 「沒有回應」那一步紅
 *   · 結果模板壞掉（欄位打錯）                                      → 「沒有畫成連結」那一步紅
 * 為什麼要瀏覽器：wasm、CSP、client 端模板都只在真的瀏覽器裡發生。
 *
 * 不防 worker 被 CSP 擋：實測 Pagefind 會退回主執行緒，搜尋照常 —— 那不是讀者看得到的故障。
 */
test('搜尋標題，點進文章 @smoke', async ({ page }, testInfo) => {
  await page.goto('/search/');

  // 名稱是 component UI 的介面字串：lang 沒寫成 zh-tw 時這裡會是簡體的「搜索」
  const box = page.getByRole('searchbox', { name: '搜尋' });
  await expect(box, '找不到名為「搜尋」的搜尋框 —— 介面字串變成簡體了？<pagefind-config lang="zh-tw"> 還在嗎').toBeVisible();
  await box.click();
  const t0 = Date.now();
  await box.pressSequentially(FIXTURE.title);

  // 兩段斷言，讓紅燈說得出是哪一層壞的：
  //   1. 摘要出現「找到 N 個」—— 搜尋引擎本身有回應（索引在、wasm 沒被擋）
  //   2. 結果裡有連到那篇的連結 —— 結果模板把它畫出來了
  // 摘要限定在 <pagefind-summary> 裡：同一句話也會寫進給螢幕閱讀器的 aria-live 區，
  // 結果出來後 100ms 寫入、停留 350ms 再清掉（Announcer 的 ANNOUNCE_DELAY_MS / CLEAR_DELAY_MS）。
  // 不限定的話，斷言落在那 350ms 內就會對到兩個元素 —— 本機剛好錯開、線上剛好撞上。
  const summary = page.locator('pagefind-summary').getByText(new RegExp(`^找到 \\d+ 個 ${FIXTURE.title} 的相關結果$`));
  await expect(summary, `${BUDGET.searchResults}ms 內搜尋沒有回應 —— 索引沒產生，或 wasm 被 CSP 擋`).toBeVisible({
    timeout: BUDGET.searchResults,
  });
  testInfo.annotations.push({ type: 'search-ms', description: String(Date.now() - t0) });

  const hit = page.locator('pagefind-results').getByRole('link', { name: FIXTURE.title, exact: true });
  await expect(hit, '搜尋有結果，但沒有畫成連到該文的連結 —— 結果模板壞了').toBeVisible();

  await hit.click();
  await expect(page).toHaveURL(FIXTURE.path);
  await expect(page.getByRole('heading', { level: 1, name: FIXTURE.title })).toBeVisible();
});
