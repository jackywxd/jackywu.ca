import { describe, expect, it } from 'vitest';
import { DISPATCH_INPUTS, STEPS } from './ci';
import { checkContentSource, checkDeployNoCancel, checkInjection, checkPublish, checkSecretScope, postbuildVerifies, type Workflow } from './workflows';

const POSTBUILD = 'node scripts/emit-redirects.mjs && node scripts/verify-fonts.mjs --strict && node scripts/verify-links.mjs --strict && node scripts/verify-wechat.mjs --strict && node scripts/verify-og-crop.mjs --strict && node scripts/verify-docs.mjs';
const RUN_NAME = 'publish ${{ inputs.request_id || github.event_name }} #${{ inputs.attempt || 0 }}';
const good = (): Workflow => ({
  'run-name': RUN_NAME,
  on: { workflow_dispatch: { inputs: Object.fromEntries(DISPATCH_INPUTS.map((k) => [k, { type: 'string', default: '' }])) } },
  concurrency: { group: 'deploy-production', 'cancel-in-progress': false },
  jobs: { publish: { steps: [
    ...STEPS.filter((s) => !['smoke', 'deploy', 'promote'].includes(s)).map((id) => ({ id, run: 'true' })),
    { id: 'promote', run: 'true' }, { id: 'deploy', run: 'pnpm exec wrangler deploy' }, { id: 'smoke', run: 'true' },
    { run: 'node scripts/ci-callback.mjs', if: 'always()' },
  ] } },
});
// good() 的 verify 步驟要和 POSTBUILD 一致
const withVerifies = (ids: string[]): Workflow => {
  const w = good();
  w.jobs!.publish!.steps = w.jobs!.publish!.steps!.filter((s) => !s.id?.startsWith('verify-'));
  const at = w.jobs!.publish!.steps!.findIndex((s) => s.id === 'promote');
  w.jobs!.publish!.steps!.splice(at, 0, ...ids.map((id) => ({ id, run: 'true' })));
  return w;
};
const ALL = ['verify-fonts', 'verify-links', 'verify-wechat', 'verify-og-crop', 'verify-docs'];
const ok = () => withVerifies(ALL);

describe('checkInjection', () => {
  const wf = (run: string): Workflow => ({ jobs: { j: { steps: [{ name: 's', run }] } } });
  it.each([
    'echo ${{ github.event.client_payload.docId }}', 'echo "${{ github.head_ref }}"', 'x=${{ inputs.name }}', 'echo ${{ github.event.pull_request.title }}',
    'echo ${{ github.event.pull_request.head.ref }}', 'echo ${{ github.event.comment.body }}',
  ])('擋下 %s', (run) => expect(checkInjection('f.yml', wf(run))).toHaveLength(1));
  it.each(['echo "$DOC"', 'echo ${{ secrets.X }}', 'echo ${{ steps.a.outputs.v }}', 'pnpm install', 'gh pr comment ${{ github.event.pull_request.number }}'])('放行 %s', (run) =>
    expect(checkInjection('f.yml', wf(run))).toEqual([]));
  it('env 區塊裡用 github.event 是正確做法，不算違規', () => {
    expect(checkInjection('f.yml', { jobs: { j: { steps: [{ run: 'echo "$P"', env: { P: '${{ github.event.client_payload.x }}' } }] } } })).toEqual([]);
  });
});

describe('postbuildVerifies', () => {
  it('依序取出 verify 腳本名', () => expect(postbuildVerifies(POSTBUILD)).toEqual(ALL));
  it('真正的 package.json postbuild 有五個', async () => {
    const pkg = JSON.parse((await import('node:fs')).readFileSync('../package.json', 'utf8'));
    expect(postbuildVerifies(pkg.scripts.postbuild)).toEqual(ALL);
  });
});

describe('checkPublish', () => {
  it('合格', () => expect(checkPublish(ok(), POSTBUILD, DISPATCH_INPUTS)).toEqual([]));
  it('少一個 verify 步驟 → 擋下', () => {
    expect(checkPublish(withVerifies(['verify-fonts', 'verify-links', 'verify-wechat', 'verify-docs']), POSTBUILD, DISPATCH_INPUTS).join()).toMatch(/不一致/);
  });
  it('verify 順序不同 → 擋下', () => {
    expect(checkPublish(withVerifies(['verify-links', 'verify-fonts', 'verify-wechat', 'verify-og-crop', 'verify-docs']), POSTBUILD, DISPATCH_INPUTS).join()).toMatch(/不一致/);
  });
  it('缺 step id → 擋下並指出是哪個', () => {
    const w = ok(); w.jobs!.publish!.steps = w.jobs!.publish!.steps!.filter((s) => s.id !== 'astro-build');
    expect(checkPublish(w, POSTBUILD, DISPATCH_INPUTS).join()).toMatch(/astro-build/);
  });
  it.each(DISPATCH_INPUTS)('workflow_dispatch 少了 input %s → 擋下（GitHub 會 422 拒絕後台的 dispatch）', (k) => {
    const w = ok(); delete (w.on as { workflow_dispatch: { inputs: Record<string, unknown> } }).workflow_dispatch.inputs[k];
    expect(checkPublish(w, POSTBUILD, DISPATCH_INPUTS).join()).toMatch(new RegExp(`缺少 input「${k}」`));
  });
  it('run-name 沒加引號，「 #」之後被 YAML 當成註解 → 擋下（看門狗會永遠找不到 run）', async () => {
    const YAML = (await import('yaml')).default;
    const w = { ...ok(), 'run-name': YAML.parse(`run-name: ${RUN_NAME}`)['run-name'] } as Workflow;
    expect(checkPublish(w, POSTBUILD, DISPATCH_INPUTS).join()).toMatch(/run-name/);
    const quoted = { ...ok(), 'run-name': YAML.parse(`run-name: '${RUN_NAME}'`)['run-name'] } as Workflow;
    expect(checkPublish(quoted, POSTBUILD, DISPATCH_INPUTS)).toEqual([]);
  });
  it('cancel-in-progress 為 true → 擋下', () => {
    const w = ok(); w.concurrency!['cancel-in-progress'] = true;
    expect(checkPublish(w, POSTBUILD, DISPATCH_INPUTS).join()).toMatch(/必須是 false/);
  });
  it('回報步驟不是 always() → 擋下', () => {
    const w = ok(); const s = w.jobs!.publish!.steps!.find((x) => x.run?.includes('ci-callback'))!; s.if = 'success()';
    expect(checkPublish(w, POSTBUILD, DISPATCH_INPUTS).join()).toMatch(/always/);
  });
  it('promote 在 deploy 之後 → 擋下', () => {
    const w = ok(); const st = w.jobs!.publish!.steps!;
    const [p] = st.splice(st.findIndex((s) => s.id === 'promote'), 1); st.splice(st.findIndex((s) => s.id === 'deploy') + 1, 0, p!);
    expect(checkPublish(w, POSTBUILD, DISPATCH_INPUTS).join()).toMatch(/promote 必須在 deploy 之前/);
  });
});

describe('checkDeployNoCancel', () => {
  it('會部署又 cancel-in-progress → 擋下', () => {
    expect(checkDeployNoCancel('d.yml', { concurrency: { 'cancel-in-progress': true }, jobs: { j: { steps: [{ run: 'pnpm exec wrangler deploy' }] } } })).toHaveLength(1);
  });
  it('PR 預覽（versions upload）可以取消，它不接管正式流量', () => {
    expect(checkDeployNoCancel('ci.yml', { concurrency: { 'cancel-in-progress': true }, jobs: { j: { steps: [{ run: 'pnpm exec wrangler versions upload' }] } } })).toEqual([]);
  });
  it('只跑測試的 workflow 可以取消', () => {
    expect(checkDeployNoCancel('ci.yml', { concurrency: { 'cancel-in-progress': true }, jobs: { j: { steps: [{ run: 'pnpm test' }] } } })).toEqual([]);
  });
});

describe('checkContentSource：網站內容的來源只由 repo 變數 CONTENT_SOURCE 決定', () => {
  const deploy = (patch: { if?: string; group?: string } = {}): Workflow => ({
    on: { push: { branches: ['main'] } },
    concurrency: { group: patch.group ?? 'deploy-git', 'cancel-in-progress': false },
    jobs: { deploy: { if: patch.if ?? "vars.CONTENT_SOURCE != 'payload'", steps: [{ run: 'pnpm exec wrangler deploy' }] } },
  });
  const publish = (patch: { push?: boolean; gate?: 'missing' | 'after-fetch' } = {}): Workflow => {
    const w = ok();
    if (patch.push !== false) (w.on as Record<string, unknown>).push = { branches: ['main'] };
    const st = w.jobs!.publish!.steps!;
    if (patch.gate === 'missing') w.jobs!.publish!.steps = st.filter((s) => s.id !== 'content-source');
    if (patch.gate === 'after-fetch') {
      const [g] = st.splice(st.findIndex((s) => s.id === 'content-source'), 1);
      st.splice(st.findIndex((s) => s.id === 'fetch-content') + 1, 0, g!);
    }
    return w;
  };
  it('合格', () => expect(checkContentSource({ 'deploy.yml': deploy(), 'publish.yml': publish() })).toEqual([]));
  it('deploy.yml 的部署 job 沒有以 CONTENT_SOURCE 把關 → 擋下（切換後會用 git 內容蓋掉線上）', () => {
    expect(checkContentSource({ 'deploy.yml': deploy({ if: 'true' }), 'publish.yml': publish() }).join()).toMatch(/deploy\.yml/);
  });
  it('publish.yml 不處理 push → 擋下（切換後程式碼的變更就沒有人部署）', () => {
    expect(checkContentSource({ 'deploy.yml': deploy(), 'publish.yml': publish({ push: false }) }).join()).toMatch(/push/);
  });
  it('publish.yml 沒有來源把關步驟 → 擋下', () => {
    expect(checkContentSource({ 'deploy.yml': deploy(), 'publish.yml': publish({ gate: 'missing' }) }).join()).toMatch(/content-source/);
  });
  it('把關步驟在 fetch-content 之後 → 擋下', () => {
    expect(checkContentSource({ 'deploy.yml': deploy(), 'publish.yml': publish({ gate: 'after-fetch' }) }).join()).toMatch(/之前/);
  });
  it('兩個 workflow 共用 concurrency 群組 → 擋下（排隊中的 run 會互相取消）', () => {
    expect(checkContentSource({ 'deploy.yml': deploy({ group: 'deploy-production' }), 'publish.yml': publish() }).join()).toMatch(/群組/);
  });
});

describe('checkSecretScope：secrets 只給需要它的那一步', () => {
  it('step 層級 → 合格', () => expect(checkSecretScope('f.yml', { jobs: { j: { steps: [{ run: 'x', env: { T: '${{ secrets.T }}' } }] } } })).toEqual([]));
  it('workflow 層級 env 放 secret → 擋下（pnpm install 的 lifecycle script 也拿得到）', () =>
    expect(checkSecretScope('f.yml', { env: { T: '${{ secrets.T }}' }, jobs: {} } as Workflow)).toHaveLength(1));
  it('job 層級 env 放 secret → 擋下', () =>
    expect(checkSecretScope('f.yml', { jobs: { j: { env: { T: '${{ secrets.T }}' }, steps: [] } } } as Workflow)).toHaveLength(1));
  it('workflow 層級放非機密設定 → 合格', () => expect(checkSecretScope('f.yml', { env: { ADMIN_URL: 'https://x' }, jobs: {} } as Workflow)).toEqual([]));
});
