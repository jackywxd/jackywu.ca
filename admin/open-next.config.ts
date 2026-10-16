import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// 後台全部是動態頁、不做 ISR，所以不需要增量快取與 tag cache。
export default defineCloudflareConfig();
