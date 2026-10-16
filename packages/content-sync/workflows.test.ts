import { describe, expect, it } from 'vitest';
import { STEPS } from './ci';
import { checkDeployNoCancel, checkInjection, checkPublish, postbuildVerifies, type Workflow } from './workflows';

const POSTBUILD = 'node scripts/emit-redirects.mjs && node scripts/verify-fonts.mjs --strict && node scripts/verify-links.mjs --strict && node scripts/verify-wechat.mjs --strict && node scripts/verify-og-crop.mjs --strict && node scripts/verify-docs.mjs';
const good = (): Workflow => ({
  on: { repository_dispatch: { types: ['content-publish'] } },
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
  it('合格', () => expect(checkPublish(ok(), POSTBUILD, 'content-publish')).toEqual([]));
  it('少一個 verify 步驟 → 擋下', () => {
    expect(checkPublish(withVerifies(['verify-fonts', 'verify-links', 'verify-wechat', 'verify-docs']), POSTBUILD, 'content-publish').join()).toMatch(/不一致/);
  });
  it('verify 順序不同 → 擋下', () => {
    expect(checkPublish(withVerifies(['verify-links', 'verify-fonts', 'verify-wechat', 'verify-og-crop', 'verify-docs']), POSTBUILD, 'content-publish').join()).toMatch(/不一致/);
  });
  it('缺 step id → 擋下並指出是哪個', () => {
    const w = ok(); w.jobs!.publish!.steps = w.jobs!.publish!.steps!.filter((s) => s.id !== 'astro-build');
    expect(checkPublish(w, POSTBUILD, 'content-publish').join()).toMatch(/astro-build/);
  });
  it('事件名不一致 → 擋下', () => {
    const w = ok(); (w.on as { repository_dispatch: { types: string[] } }).repository_dispatch.types = ['other'];
    expect(checkPublish(w, POSTBUILD, 'content-publish').join()).toMatch(/沒有監聽/);
  });
  it('cancel-in-progress 為 true → 擋下', () => {
    const w = ok(); w.concurrency!['cancel-in-progress'] = true;
    expect(checkPublish(w, POSTBUILD, 'content-publish').join()).toMatch(/必須是 false/);
  });
  it('回報步驟不是 always() → 擋下', () => {
    const w = ok(); const s = w.jobs!.publish!.steps!.find((x) => x.run?.includes('ci-callback'))!; s.if = 'success()';
    expect(checkPublish(w, POSTBUILD, 'content-publish').join()).toMatch(/always/);
  });
  it('promote 在 deploy 之後 → 擋下', () => {
    const w = ok(); const st = w.jobs!.publish!.steps!;
    const [p] = st.splice(st.findIndex((s) => s.id === 'promote'), 1); st.splice(st.findIndex((s) => s.id === 'deploy') + 1, 0, p!);
    expect(checkPublish(w, POSTBUILD, 'content-publish').join()).toMatch(/promote 必須在 deploy 之前/);
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
