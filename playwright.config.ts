import { defineConfig, devices } from '@playwright/test';

/**
 * 兩個 project，測的是同一批使用者動作，對象不同：
 *
 *   ci    —— 對 wrangler dev 跑剛建好的 dist/。wrangler dev 與線上同一套 Workers 資產處理：
 *            _headers（含 CSP）、_redirects、404-page 都會套用。astro dev / astro preview 不會，
 *            在那上面綠燈證明不了 CSP 沒擋掉搜尋的 worker。
 *   prod  —— 上線後的 smoke，對 https://jackywu.ca。只跑 @smoke 標記的旅程，
 *            加上只有部署後才看得到的東西（e2e/deployed.spec.ts）。
 *
 * 沒有 retries：這個 repo 的規矩是「flaky」必須拿出機制，不能用重試蓋掉。
 * 逾時預算見 e2e/budgets.ts，數字來自實測分布，不是感覺。
 */
const PROD = 'https://jackywu.ca';
// 不用 wrangler 的慣用埠（8787/8788）：另一個專案的 wrangler dev 佔著時，
// Playwright 會拒絕起伺服器、一支測試都不跑。
const LOCAL_PORT = Number(process.env.E2E_PORT ?? 9323);

export default defineConfig({
  testDir: 'e2e',
  retries: 0,
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    locale: 'zh-TW',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'ci',
      testIgnore: /deployed\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${LOCAL_PORT}` },
    },
    // 先確認線上已經換成這一版，其餘 smoke 才開跑 —— 否則會在舊版上驗出一片綠。
    {
      name: 'prod-live',
      testMatch: /deployed\.spec\.ts/,
      grep: /@live-build/,
      use: { baseURL: process.env.SMOKE_BASE_URL ?? PROD },
    },
    {
      name: 'prod',
      grep: /@smoke|@deployed/,
      grepInvert: /@live-build/,
      dependencies: ['prod-live'],
      use: { baseURL: process.env.SMOKE_BASE_URL ?? PROD },
    },
  ],
  // 只有 ci project 需要本機伺服器。每次都起新的：不沿用上一次留下來的狀態。
  webServer: process.argv.includes('--project=prod')
    ? undefined
    : {
        command: `pnpm exec wrangler dev --port ${LOCAL_PORT} --ip 127.0.0.1`,
        url: `http://127.0.0.1:${LOCAL_PORT}/`,
        reuseExistingServer: false,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
