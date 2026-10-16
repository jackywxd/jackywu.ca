import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * 後台 E2E：對「OpenNext 建好的 Worker」跑 wrangler dev（跟部署同一份產物）。
 * 乾淨基準：每次執行都在新的暫存目錄裡開一份全新的 D1/R2（migrations 在連線時自動套用），
 * 結束後整個刪掉。GitHub 用本機的假伺服器。測試期間任何對外請求都算失敗（見 e2e/fixtures.ts）。
 */
const PORT = 8788, GH_PORT = 8789;
const dir = (process.env.E2E_DIR ||= mkdtempSync(path.join(tmpdir(), 'hongchen-admin-e2e-')));
export const HMAC_SECRET = (process.env.E2E_HMAC ||= randomBytes(24).toString('hex'));
const VIDEO_SECRET = (process.env.E2E_VIDEO ||= randomBytes(24).toString('hex'));

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n');
const envFile = path.join(dir, 'e2e.env');
writeFileSync(envFile, [
  'ADMIN_DEV_BYPASS_EMAIL=me@example.com', `PAYLOAD_SECRET=${randomBytes(24).toString('hex')}`, `PUBLISH_HMAC_SECRET=${HMAC_SECRET}`,
  `ADMIN_URL=http://127.0.0.1:${PORT}`, `VIDEO_INTERNAL_SECRET=${VIDEO_SECRET}`, 'TRANSCODER_ACCESS_ID=e2e', 'TRANSCODER_ACCESS_SECRET=e2e',
  'GITHUB_APP_ID=1', 'GITHUB_APP_INSTALLATION_ID=2', `GITHUB_APP_PRIVATE_KEY=${pem}`, 'GITHUB_REPO=o/r', `GITHUB_API_BASE=http://127.0.0.1:${GH_PORT}`,
].join('\n') + '\n');

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: false,       // 共用一個後台與資料庫，測試各自建自己的資料、不互相依賴順序，但不並行以免互搶「一次一筆」的發佈佇列
  workers: 1,
  retries: 0,                 // 不用重試遮掩問題
  timeout: 60_000,
  reporter: [['list']],
  globalTeardown: './e2e/global-teardown.ts',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    { command: 'node e2e/fake-github.mjs', env: { FAKE_GITHUB_PORT: String(GH_PORT) }, url: `http://127.0.0.1:${GH_PORT}/__calls`, reuseExistingServer: false, timeout: 15_000 },
    {
      command: `pnpm exec wrangler dev -c wrangler.jsonc -c e2e/fake-transcoder/wrangler.jsonc --env e2e --ip 127.0.0.1 --port ${PORT} --persist-to ${dir}/state --env-file ${envFile}`,
      url: `http://127.0.0.1:${PORT}/api/users/me`, reuseExistingServer: false, timeout: 180_000, stdout: 'ignore', stderr: 'ignore',
    },
  ],
});
