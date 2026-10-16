import { createHmac } from 'node:crypto';
import { test as base, expect, type APIRequestContext } from '@playwright/test';
import sharp from 'sharp';

/** 對外請求一律擋下並記錄；測試結束時斷言清單是空的（不依賴任何外部服務：Google Fonts、CDN…） */
export const test = base.extend<{ external: string[]; api: Api }>({
  external: [async ({ context }, use) => {
    const seen: string[] = [];
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (['127.0.0.1', 'localhost'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      seen.push(route.request().url());
      return route.abort();
    });
    await use(seen);
    expect(seen, '測試期間發出了對外請求').toEqual([]);
  }, { auto: true }],
  api: async ({ request }, use) => { await use(new Api(request)); },
});
export { expect };

const GH = `http://127.0.0.1:8789`;

export class Api {
  constructor(private r: APIRequestContext) {}
  async dispatches(): Promise<{ requestId: string; kind: string; docId: string }[]> {
    return ((await (await this.r.get(`${GH}/__calls`)).json()) as { dispatches: never[] }).dispatches;
  }
  async failDispatch(n = 1) { await this.r.post(`${GH}/__fail-next?n=${n}`); }
  async resetGithub() { await this.r.post(`${GH}/__reset`); }
  /** 模擬 workflow 結束後的回呼（與 scripts/ci-callback.mjs 相同的簽章） */
  async callback(body: Record<string, unknown>) {
    const text = JSON.stringify(body);
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac('sha256', process.env.E2E_HMAC!).update(`${t}.${text}`).digest('hex')}`;
    return this.r.post('/api/publish/callback', { data: text, headers: { 'content-type': 'application/json', 'x-signature': sig } });
  }
  async status() { return ((await (await this.r.get('/api/publish/status')).json()) as { requests: { id: string; status: string; docId: string; failure?: { check: string } }[] }).requests; }
  async deleteTale(id: string | number) { await this.r.delete(`/api/tales/${id}`); }
}

/** 帶 GPS EXIF 的 JPEG：驗證上傳後 GPS 不見了 */
export async function jpegWithGps(width = 3000, height = 2000): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#6b7a8f' } })
    .withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 17/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '123/1 7/1 0/1' } })
    .jpeg().toBuffer();
}
