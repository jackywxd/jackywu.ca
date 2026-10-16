import path from 'node:path';
import { defineConfig } from 'vitest/config';

const r = (p: string) => path.resolve(import.meta.dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      '@content-rules': r('../packages/content-rules/index.ts'),
      '@payload-config': r('src/payload.config.ts'),
      '@': r('src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', '../packages/**/*.test.ts'],
    environment: 'node',
    isolate: true,
    // 整合測試要起 miniflare，給足時間；單元測試不受影響
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
