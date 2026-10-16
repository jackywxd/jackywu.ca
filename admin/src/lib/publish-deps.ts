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

/** GITHUB_API_BASE 只接受預設值或本機位址：避免設定錯誤時把 installation token 送到別的主機 */
export function apiBaseFromEnv(v: string | undefined): string | undefined {
  if (!v || v === 'https://api.github.com') return undefined;
  if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(v)) return v;
  throw new Error(`GITHUB_API_BASE 只能是 https://api.github.com 或本機位址，收到 ${v}`);
}

export function depsFromEnv(req: PayloadRequest): Deps {
  return {
    payload: req.payload,
    github: githubApp({
      appId: need('GITHUB_APP_ID'), installationId: need('GITHUB_APP_INSTALLATION_ID'),
      privateKey: need('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'), repo: process.env.GITHUB_REPO ?? 'jackywxd/jackywu.ca', apiBase: apiBaseFromEnv(process.env.GITHUB_API_BASE),
    }),
    now: () => Date.now(),
    newId: rid,
    notify: logNotice,
  };
}
