import path from 'path';
import { fileURLToPath } from 'url';
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { r2Storage } from '@payloadcms/storage-r2';
import { en } from '@payloadcms/translations/languages/en';
import { zhTw } from '@payloadcms/translations/languages/zhTw';
import { buildConfig } from 'payload';
import { getCloudflareContext, type CloudflareContext } from '@opennextjs/cloudflare';

import { Media } from './collections/Media';
import { Pages } from './collections/Pages';
import { Promoted } from './collections/Promoted';
import { PublishRequests } from './collections/PublishRequests';
import { Redirects } from './collections/Redirects';
import { Reels } from './collections/Reels';
import { Routes } from './collections/Routes';
import { Tales } from './collections/Tales';
import { Users } from './collections/Users';
import { migrations } from '../migrations';
import { publishEndpoints } from './endpoints/publish';
import { routeEndpoints } from './endpoints/routes';
import { importEndpoints } from './endpoints/import';
import { depsFromEnv } from './lib/publish-deps';
import { setBindings } from './lib/bindings';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 綁定（D1/R2）的來源：
 *  · 部署後的 Worker：getCloudflareContext
 *  · `next dev`：initOpenNextCloudflareForDev 已經放好，同一個入口
 *  · payload CLI / 測試：直接用 wrangler 的 getPlatformProxy，且「永遠」是本機模擬。
 *    ADMIN_PERSIST_DIR 指向測試自己建的暫存目錄，測試結束整個刪掉，
 *    所以每次都從空庫開始，不受上一次的殘留影響。
 */
const isCLI = process.argv.some((a) => a.endsWith(path.join('payload', 'bin.js')));
// `next dev` 不能在這裡再開一個 miniflare（兩個實例開同一個 SQLite 會 SQLITE_BUSY），
// 它的暫存目錄由 next.config.ts 的 initOpenNextCloudflareForDev 統一處理
const useWrangler = isCLI || (!!process.env.ADMIN_PERSIST_DIR && !!process.env.VITEST);

async function wranglerContext(): Promise<CloudflareContext> {
  const { getPlatformProxy } = (await import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`)) as typeof import('wrangler');
  return getPlatformProxy({
    environment: process.env.CLOUDFLARE_ENV,
    remoteBindings: false,
    persist: process.env.ADMIN_PERSIST_DIR ? { path: process.env.ADMIN_PERSIST_DIR } : undefined,
  }) as unknown as Promise<CloudflareContext>;
}

const cloudflare = useWrangler ? await wranglerContext() : await getCloudflareContext({ async: true });

// 測試與 CLI 需要把 miniflare 乾淨地關掉
if (useWrangler) {
  (globalThis as { __adminDispose?: () => Promise<void> }).__adminDispose = () =>
    (cloudflare as unknown as { dispose(): Promise<void> }).dispose();
}

setBindings(cloudflare.env);

// 部署後的 Worker 由 nodejs_compat 把 vars/secrets 放進 process.env；
// wrangler 的 getPlatformProxy 只放在 cloudflare.env，這裡補齊，兩邊行為一致。
if (useWrangler) {
  for (const [k, val] of Object.entries(cloudflare.env as unknown as Record<string, unknown>)) {
    if (typeof val === 'string' && process.env[k] === undefined) process.env[k] = val;
  }
}

export default buildConfig({
  // Payload 原生介面只留作「看原始資料／緊急修正」，日常操作走自訂 UI（見 docs/admin.md）
  routes: { admin: '/payload' },
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' — 紅塵客棧後台' },
  },
  i18n: { supportedLanguages: { en, 'zh-TW': zhTw }, fallbackLanguage: 'zh-TW' },
  collections: [Users, Media, Tales, Pages, Routes, Reels, Redirects, PublishRequests, Promoted],
  endpoints: [...publishEndpoints({ deps: depsFromEnv, hmacSecret: () => process.env.PUBLISH_HMAC_SECRET ?? '' }), ...routeEndpoints, ...importEndpoints],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: sqliteD1Adapter({
    binding: (cloudflare.env as unknown as { D1: D1Database }).D1,
    // D1 上 push 會重建已存在的索引；schema 只透過 migrations 改
    push: false,
    prodMigrations: migrations,
  }),
  plugins: [
    r2Storage({
      bucket: (cloudflare.env as unknown as { R2: R2Bucket }).R2,
      // 照片經瀏覽器縮到 2560 再傳（≤ 50MB），走 Worker 即可；影片另有分段上傳端點（M6）
      collections: { media: true },
    }),
  ],
});
