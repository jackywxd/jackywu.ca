import type { Endpoint, PayloadRequest } from 'payload';
import { REQUEST_ID_RE } from '../lib/github-app';
import { sign, verify } from '../lib/hmac';
import { handleCallback, isPublishCollection, loadRecent, loadSnapshot, requestChange, sweep, UnknownRequestError, type CallbackBody, type Deps } from '../lib/publish-service';

const MAX_BODY = 64 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const isOwner = (req: PayloadRequest) => (req.user as { role?: string } | null)?.role === 'owner';
const isReader = (req: PayloadRequest) => ['owner', 'reader'].includes((req.user as { role?: string } | null)?.role ?? '');

async function readBody(req: PayloadRequest): Promise<string | Response> {
  const text = await req.text!();
  return text.length > MAX_BODY ? json({ error: '內容太大' }, 413) : text;
}

export interface PublishEndpointConfig {
  deps: (req: PayloadRequest) => Deps;
  /** 回呼用（GitHub Actions 與後台共有） */
  hmacSecret: () => string;
  /** 排程用（cron Worker 與後台共有）。分開兩把：排程不能偽造回呼 */
  sweepSecret: () => string;
}

export function publishEndpoints(cfg: PublishEndpointConfig): Endpoint[] {
  return [
    {
      // 本人按下「發佈／撤下／刪除」
      path: '/publish/request', method: 'post',
      handler: async (req) => {
        if (!isOwner(req)) return json({ error: '需要登入' }, 401);
        const body = await readBody(req);
        if (body instanceof Response) return body;
        let p: { collection?: unknown; docId?: unknown; kind?: unknown };
        try { p = JSON.parse(body); } catch { return json({ error: 'JSON 格式不對' }, 400); }
        const { collection, docId, kind } = p;
        if (typeof collection !== 'string' || !isPublishCollection(collection)) return json({ error: '集合不對' }, 400);
        if (typeof docId !== 'string' && typeof docId !== 'number') return json({ error: 'docId 不對' }, 400);
        if (kind !== 'publish' && kind !== 'unpublish' && kind !== 'delete') return json({ error: 'kind 不對' }, 400);
        const r = await requestChange(cfg.deps(req), { collection, docId: String(docId), kind });
        if (!r.ok) return json({ errors: r.errors }, 422);
        // 從沒上線過的草稿直接刪掉，不需要建置
        return r.deleted ? json({ deleted: true }, 200) : json({ requestId: r.requestId }, 202);
      },
    },
    {
      // CI（publish.yml 的 fetch-content）拿這一筆要建置的內容。只在建置期間給
      path: '/publish/snapshot', method: 'get',
      handler: async (req) => {
        if (!isReader(req)) return json({ error: '需要登入' }, 401);
        const requestId = new URL(req.url!).searchParams.get('requestId') ?? '';
        if (!REQUEST_ID_RE.test(requestId)) return json({ error: 'requestId 不對' }, 400);
        const snapshot = await loadSnapshot(req.payload, requestId, { onlyDispatched: true });
        return snapshot ? json({ snapshot }) : json({ error: '沒有這一筆進行中的請求' }, 404);
      },
    },
    {
      // 發佈狀態（畫面輪詢）。只讀：看門狗只由排程跑，否則每個開著的分頁每 4 秒都會觸發一次轉移與 dispatch
      path: '/publish/status', method: 'get',
      handler: async (req) => {
        if (!isOwner(req)) return json({ error: '需要登入' }, 401);
        return json({ requests: await loadRecent(req.payload, 20) });
      },
    },
    {
      // workflow 結束後回報。Access 服務憑證放行 + HMAC 簽章，兩道都要過
      path: '/publish/callback', method: 'post',
      handler: async (req) => {
        const body = await readBody(req);
        if (body instanceof Response) return body;
        const v = await verify(cfg.hmacSecret(), body, req.headers.get('x-signature'));
        if (!v.ok) return json({ error: v.reason }, 401);
        let p: Partial<CallbackBody>;
        try { p = JSON.parse(body); } catch { return json({ error: 'JSON 格式不對' }, 400); }
        if (typeof p.requestId !== 'string' || !REQUEST_ID_RE.test(p.requestId)) return json({ error: 'requestId 不對' }, 400);
        if (typeof p.ok !== 'boolean') return json({ error: 'ok 必須是布林' }, 400);
        const keys = (a: unknown) => (Array.isArray(a) && a.every((k) => typeof k === 'string' && k.length < 300) ? (a as string[]) : undefined);
        try {
          const r = await handleCallback(cfg.deps(req), {
            requestId: p.requestId, ok: p.ok, check: String(p.check ?? '').slice(0, 100), summary: String(p.summary ?? '').slice(0, 2000),
            runUrl: typeof p.runUrl === 'string' && p.runUrl.startsWith('https://github.com/') ? p.runUrl : undefined,
            promoteKeys: keys(p.promoteKeys), revoked: keys(p.revoked),
            revokeAborted: typeof p.revokeAborted === 'string' ? p.revokeAborted.slice(0, 500) : undefined,
          });
          return json(r);
        } catch (e) {
          // 找不到請求是我們這邊的事實（404，CI 不重試）；其他錯誤多半是暫時的（500，CI 會重試）
          if (e instanceof UnknownRequestError) return json({ error: e.message }, 404);
          console.error(JSON.stringify({ level: 'error', msg: 'publish:callback', requestId: p.requestId, error: (e as Error).message }));
          return json({ error: '後台處理回呼時出錯' }, 500);
        }
      },
    },
    {
      // 排程（cron Worker）呼叫。簽章同回呼
      path: '/publish/sweep', method: 'post',
      handler: async (req) => {
        const body = await readBody(req);
        if (body instanceof Response) return body;
        const v = await verify(cfg.sweepSecret(), body, req.headers.get('x-signature'));
        if (!v.ok && !isOwner(req)) return json({ error: v.reason }, 401);
        return json(await sweep(cfg.deps(req)));
      },
    },
  ];
}

export { sign };
