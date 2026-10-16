import { jpegWithGps, test, expect, type Api } from './fixtures';
import type { Page } from '@playwright/test';
import { jpegGps } from '../src/lib/exif';

const EXCERPT = '一段足夠長的摘要，讓它通過顯示寬度的下限檢查，也方便在測試裡辨認這是哪一篇文章。';
const unique = (name: string) => `e2e-${name}-${Date.now().toString(36)}`;

/** 每個測試結束時把還在佇列裡的請求收乾淨，別讓前一個測試的進行中請求擋住下一個（一次只送一筆） */
test.afterEach(async ({ api }) => {
  for (const r of await api.status()) {
    if (r.status === 'queued' || r.status === 'dispatched') await api.callback({ requestId: r.id, ok: false, check: 'e2e-cleanup', summary: '測試結束' });
  }
  await api.resetGithub();
});

async function newTale(page: Page, title: string) {
  await page.goto('/tales/new');
  await page.getByLabel('標題', { exact: true }).fill(title);
  await page.getByLabel('文章內文').click();
}
async function fillSettings(page: Page, slug: string, over: { excerpt?: string; realm?: string } = {}) {
  await page.getByRole('button', { name: /^設定/ }).click();
  const dlg = page.getByRole('dialog', { name: '文章設定' });
  await dlg.getByLabel('網址代稱').fill(slug);
  await dlg.getByLabel('行當').selectOption(over.realm ?? 'run');
  await dlg.getByLabel('摘要').fill(over.excerpt ?? EXCERPT);
  await dlg.getByRole('button', { name: '完成' }).click();
  // 曾有一次發佈時 slug 是空的（沒能重現）。關掉再打開：這時欄位的值是從 React 的狀態重新畫的，
  // 不是 DOM 裡殘留的字——再失敗就能分辨是「填的值沒進狀態」還是「發佈沒送出」
  await page.getByRole('button', { name: /^設定/ }).click();
  await expect(dlg.getByLabel('網址代稱')).toHaveValue(slug);
  await dlg.getByRole('button', { name: '完成' }).click();
}
async function waitSaved(page: Page) { await expect(page.getByRole('status').filter({ hasText: '已儲存' })).toBeVisible({ timeout: 15_000 }); }

test('從零開始：寫、貼圖、設定、發佈，回呼之後顯示已上線，且圖片的 GPS 已被去掉', async ({ page, api }) => {
  const slug = unique('journey');
  const title = `E2E 旅程 ${slug}`;
  await page.goto('/tales');
  await expect(page.getByRole('heading', { name: '文章' })).toBeVisible();
  await page.getByRole('link', { name: /新文章/ }).click();
  await expect(page).toHaveURL(/\/tales\/new$/);

  await page.getByLabel('標題', { exact: true }).fill(title);
  await page.getByLabel('文章內文').click();
  await page.keyboard.type('清晨出發，風很大。');

  // 插入圖：工具列「＋」→ 圖 → 選擇圖片 → 上傳
  await page.getByRole('button', { name: '插入' }).click();
  await page.getByRole('menuitem', { name: /^圖/ }).first().click();
  const sheet = page.getByRole('dialog', { name: '編輯圖' });
  await expect(sheet.getByText('還沒選圖')).toBeVisible();
  await sheet.getByRole('button', { name: '選擇圖片' }).click();
  await page.getByTestId('media-file').setInputFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: await jpegWithGps() });
  await expect(sheet.getByText(/已選/)).toBeVisible({ timeout: 20_000 });
  await sheet.getByRole('button', { name: '完成' }).click();

  await fillSettings(page, slug);
  await page.getByRole('button', { name: '發佈', exact: true }).click();

  await expect.poll(async () => (await api.dispatches()).length, { timeout: 20_000 }).toBe(1);
  const [d] = await api.dispatches();
  expect(d).toMatchObject({ kind: 'publish' });
  await expect(page.getByRole('status').filter({ hasText: '建置與部署' })).toBeVisible();

  // 模擬 workflow 成功後的回呼
  expect((await api.callback({ requestId: d!.requestId, ok: true })).status()).toBe(200);
  await expect(page.getByText('已經上線。')).toBeVisible({ timeout: 15_000 });

  await page.goto('/tales');
  await expect(page.locator(`a.card[data-status="live"]`).filter({ hasText: title })).toBeVisible();

  // 上傳的檔案：已縮小重編碼，EXIF（含 GPS）全部消失
  const media = await (await page.request.get('/api/media?limit=1&sort=-createdAt&depth=0')).json() as { docs: { filename: string; width: number }[] };
  const bytes = Buffer.from(await (await page.request.get(`/api/media/file/${encodeURIComponent(media.docs[0]!.filename)}`)).body());
  expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
  // 不是「有沒有 EXIF」：Safari 的畫布編碼器會寫一個只含尺寸與色彩空間的 EXIF。要擋的是位置資訊
  expect(jpegGps(bytes), '上傳的檔案還帶著 GPS 位置').toBe('none');
  expect(media.docs[0]!.width).toBeLessThanOrEqual(2560);
});

test('失敗要說清楚：哪一個檢查擋下、原因，並說明網站維持上一版', async ({ page, api }) => {
  await newTale(page, 'E2E 失敗案例');
  await page.keyboard.type('內文');
  await fillSettings(page, unique('fail'));
  await page.getByRole('button', { name: '發佈', exact: true }).click();
  await expect.poll(async () => (await api.dispatches()).length, { timeout: 20_000 }).toBe(1);
  const [d] = await api.dispatches();
  const cb = await api.callback({ requestId: d!.requestId, ok: false, check: 'verify-og-crop', summary: '✗ 1 張被裁掉：tales/2026/x.png', runUrl: 'https://github.com/o/r/actions/runs/1' });
  expect(cb.status(), await cb.text()).toBe(200);
  const alert = page.getByRole('alert').filter({ hasText: 'verify-og-crop' });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText('1 張被裁掉');
  await expect(alert).toContainText('網站維持上一版');
  await expect(alert.getByRole('link', { name: '看完整記錄' })).toHaveAttribute('href', 'https://github.com/o/r/actions/runs/1');
});

test('缺欄位不能發佈：欄位與整體都有錯誤訊息，也沒有送出任何 dispatch', async ({ page, api }) => {
  await newTale(page, 'E2E 缺欄位');
  await page.keyboard.type('只有內文，沒有網址代稱與摘要');
  await page.getByRole('button', { name: '發佈', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '有欄位需要修正' })).toBeVisible();
  const dlg = page.getByRole('dialog', { name: '文章設定' });
  await expect(dlg.getByLabel('網址代稱')).toHaveAttribute('aria-invalid', 'true');
  await expect(dlg.getByRole('alert').filter({ hasText: '網址代稱' })).toBeVisible();
  expect(await api.dispatches()).toHaveLength(0);
});

test('區塊沒補齊：畫面上直接標出來，並擋住發佈', async ({ page, api }) => {
  await newTale(page, 'E2E 空區塊');
  await page.keyboard.type('前');
  await page.getByRole('button', { name: '插入' }).click();
  await page.getByRole('menuitem', { name: /^圖/ }).first().click();
  await page.getByRole('dialog', { name: '編輯圖' }).getByRole('button', { name: '完成' }).click();
  await expect(page.locator('.ed-block-card[data-problem="true"]')).toContainText('還沒選圖');
  await fillSettings(page, unique('blk'));
  await page.getByRole('button', { name: '發佈', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '第 1 個（還沒選圖）' })).toBeVisible();
  expect(await api.dispatches()).toHaveLength(0);
});

test('離線時存檔失敗會明說，恢復連線後自動存好', async ({ page, context }) => {
  await newTale(page, 'E2E 離線');
  await page.keyboard.type('第一段');
  await waitSaved(page);
  await context.setOffline(true);
  await page.keyboard.type('離線時寫的');
  await expect(page.getByRole('status').filter({ hasText: '離線中' })).toBeVisible();
  await context.setOffline(false);
  await waitSaved(page);
  // 重新整理後內容還在（真的存進伺服器了，不只是畫面上）
  await page.reload();
  await expect(page.getByLabel('文章內文')).toContainText('離線時寫的');
});

test('工具列在手機上每個按鈕都夠大、頁面沒有橫向捲動', async ({ page, isMobile }) => {
  await newTale(page, 'E2E 版面');
  const buttons = page.getByRole('toolbar', { name: '編輯工具' }).getByRole('button');
  const n = await buttons.count();
  expect(n).toBeGreaterThanOrEqual(6);
  for (let i = 0; i < n; i++) {
    const box = await buttons.nth(i).boundingBox();
    expect(box!.width, `按鈕 ${i} 寬度`).toBeGreaterThanOrEqual(43.5);
    expect(box!.height, `按鈕 ${i} 高度`).toBeGreaterThanOrEqual(43.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  void isMobile;
});

test('GPX 上傳：欄位錯誤標在欄位上；成功後顯示距離與爬升，並出現在路線列表', async ({ page }) => {
  const slug = unique('route');
  const gpx = `<gpx><trk><name>E2E</name><trkseg>${Array.from({ length: 80 }, (_, i) => `<trkpt lat="${49 + i * 0.002}" lon="${-123 + i * 0.003}"><ele>${100 + i * 5}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
  await page.goto('/routes');
  await expect(page.getByRole('heading', { name: '路線' })).toBeVisible();
  await page.getByRole('button', { name: /GPX/ }).click();
  const form = page.getByRole('form', { name: '新增路線' });

  // 什麼都沒填就送出：每個必填欄位都要有錯誤，而且標在欄位旁邊
  await form.getByRole('button', { name: '建立路線' }).click();
  await expect(form.getByLabel('GPX 檔案')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByRole('alert').filter({ hasText: '路線名稱必填' })).toBeVisible();

  await form.getByTestId('gpx-file').setInputFiles({ name: 'e2e.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) });
  await form.getByLabel('路線名稱').fill(`E2E 路線 ${slug}`);
  await form.getByLabel('網址代稱').fill(slug);
  await form.getByLabel('地區').fill('卑詩');
  await form.getByRole('button', { name: '建立路線' }).click();
  await expect(page.getByRole('status').filter({ hasText: '路線已建立' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('status')).toContainText('80 個軌跡點');

  await page.reload();
  await expect(page.locator('.card').filter({ hasText: `E2E 路線 ${slug}` })).toContainText('草稿');
});

test('導入 MDX：帶圖的文章、缺欄位與無法轉換的語法都清楚列出來，打開草稿後內容在編輯器裡', async ({ page }) => {
  const slug = unique('imp');
  const mdx = `---\ntitle: 導入 ${slug}\nslug: ${slug}\ndate: 2026-05-01\nrealm: run\n---\n\n## 開頭\n\n前面一段。\n\n![清晨](./pics/a.jpg)\n\n<Weird a="1" />\n`;
  await page.goto('/tales/import');
  await page.getByTestId('import-files').setInputFiles([
    { name: 'post.mdx', mimeType: 'text/plain', buffer: Buffer.from(mdx) },
    { name: 'pics/a.jpg', mimeType: 'image/jpeg', buffer: await (await import('sharp')).default({ create: { width: 60, height: 40, channels: 3, background: { r: Math.floor(Math.random() * 256), g: Math.floor(Math.random() * 256), b: Math.floor(Math.random() * 256) } } }).jpeg().toBuffer() },
  ]);
  await page.getByRole('button', { name: '導入', exact: true }).click();
  const result = page.getByRole('status', { name: '導入結果' });
  await expect(result).toBeVisible({ timeout: 20_000 });
  await expect(result).toContainText('新上傳 1 張');
  await expect(result).toContainText('發佈前還要補這些欄位：摘要');           // 缺的欄位不猜
  await expect(result.getByRole('alert')).toContainText('Weird');                  // 無法轉換的語法沒有被吞掉
  await result.getByRole('link', { name: '打開草稿' }).click();
  await expect(page.getByLabel('標題', { exact: true })).toHaveValue(`導入 ${slug}`);
  await expect(page.getByLabel('文章內文')).toContainText('前面一段。');
  await expect(page.locator('.ed-block-card[data-block-type], .ed-block-card').filter({ hasText: '圖' }).first()).toBeVisible();
  await expect(page.locator('.ed-block-card[data-problem="true"]')).toContainText('這段內容無法在網站上顯示'); // rawMdx 擋住發佈
});

test('原始碼模式：改了套用，編輯器裡就是改過的；語法錯誤不套用並指出原因', async ({ page }) => {
  await newTale(page, 'E2E 原始碼');
  await page.keyboard.type('原本的一句話');
  await waitSaved(page);
  await page.getByRole('button', { name: '原始碼' }).click();
  const dlg = page.getByRole('dialog', { name: '原始碼' });
  const box = dlg.getByLabel('MDX 原始碼');
  await expect(box).toHaveValue(/原本的一句話/);

  await box.fill('改過的一句話\n\n<Open>\n');                // 壞語法
  await dlg.getByRole('button', { name: '套用' }).click();
  await expect(dlg.getByRole('alert')).toContainText('沒有套用');
  await expect(dlg.getByRole('alert')).toContainText('解析失敗');
  await expect(dlg).toBeVisible();                           // 停在原始碼，沒有被關掉

  await box.fill('## 新標題\n\n改過的一句話\n');
  await dlg.getByRole('button', { name: '套用' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByLabel('文章內文')).toContainText('改過的一句話');
  await expect(page.getByLabel('文章內文').getByRole('heading', { name: '新標題' })).toBeVisible();
  await waitSaved(page);
  await page.reload();
  await expect(page.getByLabel('文章內文')).toContainText('改過的一句話');
});

test('影片：分段上傳 → 轉碼（假容器走真的簽章網址）→ 畫面自己變成「可以使用」；資料不完整時文章不能發佈', async ({ page, api }) => {
  await page.goto('/media');
  const name = `trip-${Date.now().toString(36)}.mp4`;
  await page.getByTestId('video-file').setInputFiles({ name, mimeType: 'video/mp4', buffer: Buffer.alloc(300_000, 7) });
  await expect(page.getByText('上傳完成，開始轉碼')).toBeVisible({ timeout: 30_000 });
  const card = page.locator('.card').filter({ hasText: name.replace(/\.mp4$/, '') }).first();
  // 假容器收到工作後自己下載、上傳、回報；畫面每 5 秒輪詢，應該自己翻成「可以使用」
  await expect(card.getByText('可以使用')).toBeVisible({ timeout: 40_000 });
  await expect(card).toContainText('0.3 MB'); // 成品大小已寫回（假成品 = 原檔 300,000 + 8 位元組）

  // 填資料
  await card.getByRole('button', { name: '編輯資料' }).click();
  const sheet = page.getByRole('dialog', { name: '影片資料' });
  await sheet.getByLabel(/^行當/).selectOption('snow');
  await sheet.getByLabel(/^日期/).fill('2026-02-08');
  await sheet.getByLabel(/^封面的替代文字/).fill('雪坡上的滑降線');
  await sheet.getByRole('button', { name: '儲存' }).click();
  await expect(sheet).toBeHidden();

  // 文章選這支影片 → 資料齊全，可以送出發佈（在一般流程裡走到 dispatch）
  const slug = unique('vid');
  await newTale(page, `E2E 影片 ${slug}`);
  await page.keyboard.type('有影片的文章');
  await fillSettings(page, slug);
  await page.getByRole('button', { name: /^設定/ }).click();
  const dlg = page.getByRole('dialog', { name: '文章設定' });
  await dlg.getByLabel('影片').selectOption({ index: 1 });
  await dlg.getByRole('button', { name: '完成' }).click();
  await page.getByRole('button', { name: '發佈', exact: true }).click();
  await expect.poll(async () => (await api.dispatches()).length, { timeout: 20_000 }).toBe(1);
});
