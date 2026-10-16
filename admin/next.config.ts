import type { NextConfig } from 'next';
import { withPayload } from '@payloadcms/next/withPayload';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const nextConfig: NextConfig = {
  // 共用規則（packages/content-rules）在專案根目錄之外
  experimental: { externalDir: true },
  // jose / drizzle-kit 走 workerd 專用路徑，不打包進 bundle
  serverExternalPackages: ['jose', 'pg-cloudflare', 'drizzle-kit'],
  poweredByHeader: false,
};

// 開發時只用本機模擬的 binding；絕不連線上的 D1/R2
initOpenNextCloudflareForDev({ remoteBindings: false });

export default withPayload(nextConfig, { devBundleServerPackages: false });
