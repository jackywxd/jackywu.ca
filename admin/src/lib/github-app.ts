import { importPKCS8, SignJWT } from 'jose';
import type { RunConclusion } from './publish-queue';

/**
 * GitHub App：只負責送 repository_dispatch 與查 workflow run 的結論。
 * 不用 PAT：fine-grained token 最長一年就過期，到時候發佈會突然壞掉；
 * App 的 installation token 每次現簽，不會過期。權限：contents:read、actions:write、metadata:read。
 */
export interface GitHubConfig { appId: string; installationId: string; privateKey: string; repo: string /* owner/name */ }
export interface DispatchPayload { requestId: string; kind: string; collection: string; docId: string; versionId: string }
export interface GitHub {
  dispatch(p: DispatchPayload): Promise<void>;
  runConclusion(requestId: string): Promise<RunConclusion>;
}

export const REQUEST_ID_RE = /^[a-z0-9]{20,32}$/;
export const EVENT_TYPE = 'content-publish';

type Fetch = typeof fetch;

export function githubApp(cfg: GitHubConfig, f: Fetch = fetch, now: () => number = () => Date.now()): GitHub {
  let cached: { token: string; exp: number } | null = null;
  const api = async (path: string, init: RequestInit & { auth: string }) => {
    const { auth, ...rest } = init;
    return f(`https://api.github.com${path}`, {
      ...rest,
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'hongchen-admin', authorization: auth, ...(rest.headers ?? {}) },
    });
  };

  async function token(): Promise<string> {
    if (cached && cached.exp - now() > 60_000) return cached.token;
    const key = await importPKCS8(cfg.privateKey, 'RS256');
    const iat = Math.floor(now() / 1000) - 30; // 容許時鐘偏差
    const jwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(cfg.appId).setIssuedAt(iat).setExpirationTime(iat + 9 * 60).sign(key);
    const r = await api(`/app/installations/${cfg.installationId}/access_tokens`, { method: 'POST', auth: `Bearer ${jwt}` });
    if (!r.ok) throw new Error(`取得 installation token 失敗 ${r.status}：${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { token: string; expires_at: string };
    cached = { token: j.token, exp: Date.parse(j.expires_at) };
    return j.token;
  }

  return {
    async dispatch(p) {
      if (!REQUEST_ID_RE.test(p.requestId)) throw new Error(`requestId 格式不對：${p.requestId}`);
      const r = await api(`/repos/${cfg.repo}/dispatches`, {
        method: 'POST', auth: `token ${await token()}`,
        body: JSON.stringify({ event_type: EVENT_TYPE, client_payload: p }),
      });
      if (r.status !== 204) throw new Error(`repository_dispatch 失敗 ${r.status}：${(await r.text()).slice(0, 200)}`);
    },
    async runConclusion(requestId) {
      const r = await api(`/repos/${cfg.repo}/actions/runs?event=repository_dispatch&per_page=50`, { auth: `token ${await token()}` });
      if (!r.ok) throw new Error(`查詢 workflow runs 失敗 ${r.status}`);
      const runs = ((await r.json()) as { workflow_runs: { display_title?: string; name?: string; status: string; conclusion: string | null }[] }).workflow_runs;
      // workflow 的 run-name 含 requestId（見 publish.yml）
      const run = runs.find((x) => (x.display_title ?? x.name ?? '').includes(requestId));
      if (!run) return 'unknown';
      if (run.status !== 'completed') return 'in_progress';
      return (['success', 'failure', 'cancelled', 'timed_out'] as const).includes(run.conclusion as never)
        ? (run.conclusion as RunConclusion)
        : 'failure';
    },
  };
}
