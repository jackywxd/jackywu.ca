import type { PayloadRequest } from 'payload';
import { githubApp } from './github-app';
import type { Deps, Notice } from './publish-service';

const need = (k: string) => process.env[k] || (() => { throw new Error(`缺少環境變數 ${k}`); })();

/** 通知：先寫結構化 log（Workers observability 看得到）；Email 管道在 M5 的通知步驟接上 */
export async function logNotice(n: Notice) {
  console.log(JSON.stringify({ level: n.kind === 'published' ? 'info' : 'warn', msg: `publish:${n.kind}`, requestId: n.request?.id, doc: n.request ? `${n.request.collection}/${n.request.docId}` : undefined, detail: n.detail ?? n.request?.failure?.summary }));
}

const rid = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => (x % 36).toString(36)).join('') + Date.now().toString(36).padStart(8, '0');
};

export function depsFromEnv(req: PayloadRequest): Deps {
  return {
    payload: req.payload,
    github: githubApp({
      appId: need('GITHUB_APP_ID'), installationId: need('GITHUB_APP_INSTALLATION_ID'),
      privateKey: need('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'), repo: process.env.GITHUB_REPO ?? 'jackywxd/jackywu.ca',
    }),
    now: () => Date.now(),
    newId: rid,
    notify: logNotice,
  };
}
