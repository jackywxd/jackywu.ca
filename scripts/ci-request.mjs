#!/usr/bin/env node
/** publish.yml 第一步：驗 workflow_dispatch 的 inputs，寫成 request.json。外來輸入只經過這裡，不進 shell。 */
import { writeFileSync } from 'node:fs';
import { parseDispatch } from '../packages/content-sync/ci.ts';

const r = parseDispatch(process.env.INPUTS_JSON);
if (!r) {
  // push 或手動執行：沒有請求，只是用目前已上線的內容重新部署
  writeFileSync('request.json', 'null');
  console.log('沒有請求（重新部署目前已上線的內容）');
} else {
  writeFileSync('request.json', JSON.stringify({ id: r.id, kind: r.kind, collection: r.collection, docId: r.docId, versionId: r.versionId, attempt: r.attempt }));
  console.log(`請求 ${r.id}：${r.kind} ${r.collection}/${r.docId}`);
}
