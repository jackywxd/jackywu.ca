import type { PayloadRequest } from 'payload';
import { githubApp } from './github-app';
import type { Deps, Notice } from './publish-service';
import { bindings } from './bindings';
import { emailNotifier } from './notify';

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
    notify: notifier(),
  };
}

/**
 * log 一定寫；有 MAILER（寄信用的獨立 Worker，經由 service binding）就再寄信。
 * 不在後台自己 import 'cloudflare:email'：OpenNext 的打包解析不了它。
 * 寄信失敗只記 log（emailNotifier 保證不丟例外）。
 */
function notifier() {
  const mailer = (() => { try { return bindings().MAILER; } catch { return undefined; } })();
  if (!mailer) return logNotice;
  const mail = emailNotifier({
    from: 'unused', to: 'unused', adminUrl: process.env.ADMIN_URL ?? '',
    log: (m) => console.warn(JSON.stringify({ level: 'warn', msg: m })),
    // 收件人與寄件人只存在於 mailer 的設定裡；後台只交出「主旨與內文」，無法指定寄給誰
    send: async () => { throw new Error('unused'); },
    deliver: async (mail) => {
      const r = await mailer.fetch(new Request('https://mailer/send', { method: 'POST', body: JSON.stringify(mail), headers: { 'content-type': 'application/json' } }));
      if (!r.ok) throw new Error(`mailer 回 ${r.status}：${(await r.text()).slice(0, 200)}`);
    },
  });
  return async (n: Notice) => { await logNotice(n); await mail(n); };
}
