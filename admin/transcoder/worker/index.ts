/**
 * 轉碼 Worker：只做一件事——把後台交代的工作丟給容器。
 * 沒有公開路由（workers_dev 關閉、沒有 routes），只能經由後台的 service binding 呼叫。
 * 容器一次處理一支影片；每支影片用自己的 id 當容器實例名，所以兩支影片不會共用一個容器。
 */
import { Container, getContainer } from '@cloudflare/containers';
import { onExpiry, type ContainerStatus } from './lifecycle';

interface Env { TRANSCODER: DurableObjectNamespace<Transcoder> }

export class Transcoder extends Container<Env> {
  defaultPort = 8080;
  // 轉完就睡：不閒置燒錢。容器自己會回報結果，不需要常駐
  sleepAfter = '10m';

  /** 閒置到期：還在轉就不停（預設行為會把還在跑的 ffmpeg 殺掉）。決策在 lifecycle.ts */
  override async onActivityExpired(): Promise<void> {
    let status: ContainerStatus = null;
    try { status = (await (await this.containerFetch('http://container/health')).json()) as ContainerStatus; } catch { status = null; }
    if (onExpiry(status, Date.now()) === 'stop') await this.stop();
  }
}

const JOB_ID = /^\d{1,12}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/start') return new Response('not found', { status: 404 });

    let body: { jobId?: unknown; env?: Record<string, unknown> };
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
    if (typeof body.jobId !== 'string' || !JOB_ID.test(body.jobId)) return new Response('bad jobId', { status: 400 });
    const e = body.env ?? {};
    for (const k of ['SRC_URL', 'OUT_URL', 'DONE_URL']) if (typeof e[k] !== 'string') return new Response(`missing ${k}`, { status: 400 });

    const c = getContainer(env.TRANSCODER, body.jobId);
    await c.startAndWaitForPorts();
    // 容器收到就回 202，之後自己下載、轉碼、上傳、回報；Worker 不必（也不能）一路等到結束
    return c.fetch(new Request('http://container/run', { method: 'POST', body: JSON.stringify(e) }));
  },
};
