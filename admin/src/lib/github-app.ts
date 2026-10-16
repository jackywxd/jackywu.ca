import { importPKCS8, SignJWT } from 'jose';
import type { RunConclusion } from './publish-queue';
import { dispatchInputs, PUBLISH_WORKFLOW } from '../../../packages/content-sync/ci';

/**
 * GitHub App：只負責觸發 publish.yml（workflow_dispatch）與查 workflow run 的結論。
 * 不用 PAT：fine-grained token 最長一年就過期，到時候發佈會突然壞掉；
 * App 的 installation token 每次現簽，不會過期。權限：Actions: Read and write、Metadata: Read。
 * 不用 repository_dispatch：它要 Contents: write，等於讓這把鑰匙能推程式碼。
 */
export interface GitHubConfig { appId: string; installationId: string; privateKey: string; repo: string /* owner/name */; /** 跑哪個分支的 publish.yml，預設 main */ ref?: string; /** 只給本機 E2E 的假 GitHub 用；正式環境固定是 api.github.com */ apiBase?: string }
export interface DispatchPayload { requestId: string; kind: string; collection: string; docId: string; versionId: string; /** 第幾次嘗試：寫進 run-name，看門狗才分得出重送前後的 run */ attempt: number }
export interface GitHub {
  dispatch(p: DispatchPayload): Promise<void>;
  runConclusion(requestId: string, attempt: number): Promise<RunConclusion>;
}

export const REQUEST_ID_RE = /^[a-z0-9]{20,32}$/;
export const runTitle = (requestId: string, attempt: number) => `publish ${requestId} #${attempt}`;

type Fetch = typeof fetch;

export function githubApp(cfg: GitHubConfig, f: Fetch = fetch, now: () => number = () => Date.now()): GitHub {
  let cached: { token: string; exp: number } | null = null;
  const api = async (path: string, init: RequestInit & { auth: string }) => {
    const { auth, ...rest } = init;
    return f(`${cfg.apiBase ?? 'https://api.github.com'}${path}`, {
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
      const r = await api(`/repos/${cfg.repo}/actions/workflows/${PUBLISH_WORKFLOW}/dispatches`, {
        method: 'POST', auth: `token ${await token()}`,
        body: JSON.stringify({ ref: cfg.ref ?? 'main', inputs: dispatchInputs(p) }),
      });
      // 204 是舊行為；要求回傳 run 資訊時是 200。兩者都代表 GitHub 已經收下
      if (r.status !== 204 && r.status !== 200) throw new Error(`workflow_dispatch 失敗 ${r.status}：${(await r.text()).slice(0, 200)}`);
    },
    async runConclusion(requestId, attempt) {
      const r = await api(`/repos/${cfg.repo}/actions/workflows/${PUBLISH_WORKFLOW}/runs?event=workflow_dispatch&per_page=50`, { auth: `token ${await token()}` });
      if (!r.ok) throw new Error(`查詢 workflow runs 失敗 ${r.status}`);
      const runs = ((await r.json()) as { workflow_runs: { display_title?: string; name?: string; status: string; conclusion: string | null }[] }).workflow_runs;
      // workflow 的 run-name 是「publish <requestId> #<attempt>」（見 publish.yml）。比對整個標題：
      // 重送之後新的 run 還沒建出來時，不能把上一次被取消的 run 當成這一次的結論
      const title = runTitle(requestId, attempt);
      const run = runs.find((x) => (x.display_title ?? x.name ?? '') === title);
      if (!run) return 'unknown';
      if (run.status !== 'completed') return 'in_progress';
      return (['success', 'failure', 'cancelled', 'timed_out'] as const).includes(run.conclusion as never)
        ? (run.conclusion as RunConclusion)
        : 'failure';
    },
  };
}
