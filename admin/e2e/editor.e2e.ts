import { test, expect } from './fixtures';
import type { Browser, Page } from '@playwright/test';

/**
 * 編輯器不能弄丟東西。每一條對應審查時找到的一個資料遺失路徑（docs/reviews/2026-10-16-admin-branch.md P0-8、P1-14、P1-15、P2）。
 * 這些只有在瀏覽器裡才看得到：React 的狀態、Lexical 的 onChange、localStorage、兩台裝置。
 */
const EXCERPT = '一段足夠長的摘要，讓它通過顯示寬度的下限檢查，也方便在測試裡辨認這是哪一篇文章。';
const unique = (name: string) => `e2e-${name}-${Date.now().toString(36)}`;
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const body = (page: Page) => page.getByLabel('文章內文');

test.afterEach(async ({ api }) => {
  for (const r of await api.status()) {
    if (r.status === 'queued' || r.status === 'dispatched') await api.callback({ requestId: r.id, ok: false, check: 'e2e-cleanup', summary: '測試結束' });
  }
  await api.resetGithub();
});

/** 開一篇新文章、打一段字，等它存好（建立了文件、網址換成 /tales/<id>） */
async function savedTale(page: Page, title: string, text = '原本的內文') {
  await page.goto('/tales/new');
  await page.getByLabel('標題', { exact: true }).fill(title);
  await body(page).click();
  await page.keyboard.type(text);
  await expect(status(page, '已儲存')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/tales\/\d+$/);
  return page.url().match(/\/tales\/(\d+)$/)![1]!;
}
async function settings(page: Page, slug: string) {
  await page.getByRole('button', { name: /^設定/ }).click();
  const dlg = page.getByRole('dialog', { name: '文章設定' });
  await dlg.getByLabel('網址代稱').fill(slug);
  await dlg.getByLabel('行當').selectOption('run');
  await dlg.getByLabel('摘要').fill(EXCERPT);
  await dlg.getByRole('button', { name: '完成' }).click();
}

test('已經存過的文章只做一次編輯（一次貼上）：會存，重新整理後還在', async ({ page }) => {
  await savedTale(page, `E2E 一次編輯 ${unique('one')}`);
  await page.reload();
  await body(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('，補一句'); // 一次更新（貼上、輸入法送出都是這樣）
  await expect(status(page, '尚未儲存')).toBeVisible();
  await expect(status(page, '已儲存')).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(body(page)).toContainText('原本的內文，補一句');
});

test('標籤可以連續打好幾個（先前一打到分隔符號就被吃掉）', async ({ page }) => {
  await page.goto('/tales/new');
  await page.getByRole('button', { name: /^設定/ }).click();
  const tags = page.getByRole('dialog', { name: '文章設定' }).getByLabel('標籤');
  await tags.pressSequentially('跑步，越野 長跑');
  await expect(tags).toHaveValue('跑步，越野 長跑');
});

test('刪除從沒上線的草稿：確認之後直接刪掉、回到列表，不需要建置', async ({ page, api }) => {
  const id = await savedTale(page, `E2E 刪除草稿 ${unique('del')}`);
  await page.getByRole('button', { name: /^設定/ }).click();
  await page.getByRole('dialog', { name: '文章設定' }).getByRole('button', { name: '刪除' }).click();
  await page.getByRole('dialog', { name: '刪除這篇' }).getByRole('button', { name: '刪除', exact: true }).click();
  await expect(page).toHaveURL(/\/tales$/);
  expect(await api.dispatches()).toHaveLength(0);
  expect((await page.request.get(`/api/tales/${id}?draft=true`)).status()).toBe(404);
});

test('撤下已上線的文章：一鍵送出，部署成功後不再是上線狀態', async ({ page, api }) => {
  const slug = unique('unpub');
  await savedTale(page, `E2E 撤下 ${slug}`);
  await settings(page, slug);
  await page.getByRole('button', { name: '發佈', exact: true }).click();
  await expect.poll(async () => (await api.dispatches()).length, { timeout: 20_000 }).toBe(1);
  const [p] = await api.dispatches();
  expect((await api.callback({ requestId: p!.requestId, ok: true })).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: /^設定/ }).click();
  await page.getByRole('dialog', { name: '文章設定' }).getByRole('button', { name: '撤下' }).click();
  await page.getByRole('dialog', { name: '撤下這篇' }).getByRole('button', { name: '撤下', exact: true }).click();
  await expect.poll(async () => (await api.dispatches()).length, { timeout: 20_000 }).toBe(2);
  const u = (await api.dispatches())[1]!;
  expect(u.kind).toBe('unpublish');
  expect((await api.callback({ requestId: u.requestId, ok: true })).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: /^設定/ }).click();
  await expect(page.getByRole('dialog', { name: '文章設定' }).getByRole('button', { name: '撤下' })).toHaveCount(0);
});

async function secondDevice(browser: Browser) {
  const ctx = await browser.newContext();
  // 第二台裝置一樣不准對外連線
  await ctx.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
  return ctx;
}

test('兩台裝置改同一篇：後存的那邊不會默默蓋掉先存的，而是跳出選擇', async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000); // 存檔節奏是「至少相隔 30 秒」，這條要等兩輪
  const id = await savedTale(page, `E2E 衝突 ${unique('conflict')}`);
  const ctx = await secondDevice(browser);
  try {
    const other = await ctx.newPage();
    await other.goto(`${baseURL}/tales/${id}`);
    await expect(body(other)).toContainText('原本的內文');
    // 第一台先改、先存（兩次存檔至少相隔 30 秒）
    await body(page).click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type('（桌機）');
    await expect(status(page, '尚未儲存')).toBeVisible();
    await expect(status(page, '已儲存')).toBeVisible({ timeout: 45_000 });
    // 第二台拿著舊版本改
    await body(other).click(); await other.keyboard.press('ControlOrMeta+End'); await other.keyboard.type('（手機）');
    await expect(other.getByRole('alert').filter({ hasText: '別的裝置上也改過了' })).toBeVisible({ timeout: 20_000 });
    // 伺服器上仍是桌機的版本
    const server = await (await page.request.get(`/api/tales/${id}?draft=true&depth=0`)).json() as { content: unknown };
    expect(JSON.stringify(server.content)).toContain('（桌機）');
    expect(JSON.stringify(server.content)).not.toContain('（手機）');
  } finally { await ctx.close(); }
});

test('本機有比較新的草稿時：回答之前編輯區不能打字，本機草稿不會被覆寫', async ({ page }) => {
  const id = await savedTale(page, `E2E 本機草稿 ${unique('local')}`);
  const server = await (await page.request.get(`/api/tales/${id}?draft=true&depth=0`)).json() as { updatedAt: string; title: string };
  const text = (t: string) => ({ type: 'text', text: t, format: 0, detail: 0, mode: 'normal', style: '', version: 1 });
  const content = { root: { type: 'root', direction: null, format: '', indent: 0, version: 1, children: [{ type: 'paragraph', direction: null, format: '', indent: 0, version: 1, textFormat: 0, textStyle: '', children: [text('山上寫的那一段')] }] } };
  await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [`tale-draft:${id}`, JSON.stringify({ meta: { title: server.title }, content, at: Date.now(), baseUpdatedAt: server.updatedAt })]);
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: '比伺服器更新的草稿' })).toBeVisible();
  await body(page).click({ force: true });
  await page.keyboard.type('不該進去的字');
  const kept = await page.evaluate((k) => localStorage.getItem(k), `tale-draft:${id}`);
  expect(kept).toContain('山上寫的那一段');
  expect(kept).not.toContain('不該進去的字');
  await page.getByRole('button', { name: '用這台裝置的版本' }).click();
  await expect(body(page)).toContainText('山上寫的那一段');
});

test('發佈時欄位沒過：設定抽屜把焦點放在出錯的欄位上，不是第一個欄位', async ({ page }) => {
  // 實際發生過：只缺摘要，抽屜打開後焦點（朱砂色的框）落在網址代稱上，看起來像是網址代稱錯了；真正的錯誤在畫面外
  await savedTale(page, `E2E 缺摘要 ${unique('noexcerpt')}`);
  await page.getByRole('button', { name: /^設定/ }).click();
  const dlg = page.getByRole('dialog', { name: '文章設定' });
  await dlg.getByLabel('網址代稱').fill(unique('noexcerpt'));
  await dlg.getByLabel('行當').selectOption('run');
  await dlg.getByRole('button', { name: '完成' }).click();
  await page.getByRole('button', { name: '發佈', exact: true }).click();
  await expect(dlg.getByLabel('摘要')).toBeFocused();
  await expect(dlg.getByLabel('網址代稱')).not.toHaveAttribute('aria-invalid', 'true');
});
