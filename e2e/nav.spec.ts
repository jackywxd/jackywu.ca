import { test, expect, devices } from '@playwright/test';
import { MANUAL } from './fixtures';

/**
 * 手機導覽。
 *
 * 防的是：手機上整站導覽到不了 —— 選單打不開、或收起後沒有路回去 ——
 * 而拿桌機檢查的人完全看不出來（桌機上導覽是平鋪的一行，選單根本不存在）。
 * 選單是 JS 驅動的點擊行為，所以放在瀏覽器層，這是觀察得到它的最便宜的一層。
 */
test.use({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' });

test('手機：打開選單、按 Esc 收起、再打開走到凡例', async ({ page }) => {
  await page.goto('/');

  // 名稱照規格計算 —— 螢幕閱讀器聽到的就是這個
  const btn = page.getByRole('button', { name: '選單' });
  const target = page.getByRole('navigation', { name: '主導覽' }).getByRole('link', { name: MANUAL.title });

  await expect(btn, '手機上看不到「選單」按鈕 —— :root.js 沒掛上，或按鈕沒有可讀的名稱').toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(target, '選單還沒打開，導覽連結就已經看得見了 —— 手機上沒有收起').toBeHidden();

  await btn.click();
  // 造過：拔掉點擊處理 → 紅在這一行（按鈕永遠不會變成「收起」）
  await expect(page.getByRole('button', { name: '收起' }), '按了選單沒有展開 —— 點擊處理沒接上').toHaveAttribute('aria-expanded', 'true');
  await expect(target, '按了選單，導覽連結還是看不見').toBeVisible();
  // 分組名要念得出來，否則螢幕閱讀器使用者只聽到一串沒有結構的連結
  await expect(page.getByRole('group', { name: '行當' })).toBeVisible();

  // Esc 收起，焦點回到按鈕 —— 否則鍵盤使用者會被丟在一個剛消失的面板裡
  await page.keyboard.press('Escape');
  await expect(target).toBeHidden();
  await expect(page.getByRole('button', { name: '選單' })).toBeFocused();

  await page.getByRole('button', { name: '選單' }).click();
  await target.click();
  await expect(page).toHaveURL(MANUAL.path);
});

test('手機、沒有 JS：導覽照舊攤開，不會變成一個打不開的選單', async ({ browser }) => {
  // 防的是：有人把「收起」的樣式寫成無條件的 —— 那麼關掉 JS 的讀者手機上就沒有任何導覽
  // 造過：把收起規則的 :root.js 條件拿掉 → 這支紅，另一支照綠
  const ctx = await browser.newContext({ ...devices['iPhone 13'], javaScriptEnabled: false });
  const page = await ctx.newPage();
  try {
    await page.goto('/');
    await expect(
      page.getByRole('navigation', { name: '主導覽' }).getByRole('link', { name: MANUAL.title }),
      '沒有 JS 時導覽連結看不見 —— 收起的樣式沒有被 :root.js 擋住',
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '選單' }), '沒有 JS 卻出現了選單按鈕 —— 它按了也不會有反應').toBeHidden();
  } finally {
    await ctx.close();
  }
});
