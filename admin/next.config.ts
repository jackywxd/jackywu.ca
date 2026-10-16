import type { NextConfig } from 'next';
import { withPayload } from '@payloadcms/next/withPayload';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const nextConfig: NextConfig = {
  // 共用規則（packages/content-rules）在專案根目錄之外
  experimental: { externalDir: true },
  // jose / drizzle-kit 走 workerd 專用路徑，不打包進 bundle
  serverExternalPackages: ['jose', 'pg-cloudflare', 'drizzle-kit'],
  poweredByHeader: false,
  // 後台不能被別的網站框起來（誘騙本人點「發佈」「刪除」）。只設 frame-ancestors：
  // 完整的 CSP 會擋到 Payload 自己的管理介面（/payload）的行內腳本，那要另外處理
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
      ],
    }];
  },
};

// 開發時只用本機模擬的 binding；絕不連線上的 D1/R2
initOpenNextCloudflareForDev({
  remoteBindings: false,
  // 測試（Playwright）用的暫存目錄：每次從空庫開始，結束整個刪掉
  persist: process.env.ADMIN_PERSIST_DIR ? { path: process.env.ADMIN_PERSIST_DIR } : undefined,
});

export default withPayload(nextConfig, { devBundleServerPackages: false });
