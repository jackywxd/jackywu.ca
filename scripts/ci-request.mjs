#!/usr/bin/env node
/** publish.yml 第一步：驗 client_payload，寫成 request.json。外來輸入只經過這裡，不進 shell。 */
import { writeFileSync } from 'node:fs';
import { parseRequest } from '../packages/content-sync/ci.ts';

const raw = process.env.PAYLOAD_JSON;
if (!raw || raw === 'null') {
  // push 或 workflow_dispatch：沒有請求，只是用目前已上線的內容重新部署
  writeFileSync('request.json', 'null');
  console.log('沒有請求（手動重新部署目前已上線的內容）');
} else {
  const r = parseRequest(JSON.parse(raw));
  writeFileSync('request.json', JSON.stringify({ id: r.id, kind: r.kind, collection: r.collection, docId: r.docId, versionId: r.versionId, attempt: r.attempt }));
  console.log(`請求 ${r.id}：${r.kind} ${r.collection}/${r.docId}`);
}
