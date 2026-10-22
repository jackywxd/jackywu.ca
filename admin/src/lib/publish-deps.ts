import type { PayloadRequest } from 'payload';
import { githubApp, type GitHub } from './github-app';
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

/** 線上的 content-manifest.json：run 結束卻沒有回呼時，看門狗用它確認是否其實已經上線 */
export function liveManifestFrom(site: string, f: typeof fetch = fetch) {
  return async (): Promise<{ requestId?: string | null; promoted?: string[] } | null> => {
    try {
      const r = await f(`${site.replace(/\/$/, '')}/content-manifest.json`, { headers: { 'cache-control': 'no-cache' } });
      if (!r.ok) return null;
      const j = (await r.json()) as { requestId?: unknown; promoted?: unknown };
      return {
        requestId: typeof j.requestId === 'string' ? j.requestId : null,
        promoted: Array.isArray(j.promoted) ? j.promoted.filter((k): k is string => typeof k === 'string') : [],
      };
    } catch { return null; }
  };
}

const GITHUB_KEYS = ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY'] as const;

export function depsFromEnv(req: PayloadRequest): Deps {
  // GitHub App 的設定用到才讀：刪除從沒上線過的草稿不需要 GitHub。先前在這裡一次讀完，
  // 沒設 GitHub App 的環境（staging）連刪草稿都是 500「送出失敗」
  let app: GitHub | undefined;
  const gh = () => (app ??= githubApp({
    appId: need('GITHUB_APP_ID'), installationId: need('GITHUB_APP_INSTALLATION_ID'),
    privateKey: need('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'), repo: process.env.GITHUB_REPO ?? 'jackywxd/jackywu.ca', apiBase: apiBaseFromEnv(process.env.GITHUB_API_BASE),
  }));
  return {
    payload: req.payload,
    // async：缺設定時是被拒絕的 Promise，不是同步丟錯（GitHub 的介面回 Promise，用 .catch 的呼叫端才接得到）
    github: { dispatch: async (p) => gh().dispatch(p), runConclusion: async (id, attempt) => gh().runConclusion(id, attempt) },
    dispatchUnavailable: () => {
      const missing = GITHUB_KEYS.filter((k) => !process.env[k]);
      return missing.length ? `這個環境沒有設定發佈（缺少 ${missing.join('、')}），發佈、撤下、刪除已上線的文章只能在正式後台做` : null;
    },
    now: () => Date.now(),
    newId: rid,
    notify: notifier(),
    liveManifest: liveManifestFrom(process.env.PUBLIC_SITE_URL ?? 'https://jackywu.ca'),
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
