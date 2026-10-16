// 容器的入口：Worker 用 POST /run 帶著環境參數叫它開工；回 202，結果由 transcode.mjs 直接回報給後台。
import http from 'node:http';
import { run } from './transcode.mjs';

let busy = false, since = null;
http.createServer(async (req, res) => {
  // Worker 的 Transcoder 在閒置到期時問這裡：還在轉就不停（見 transcoder/worker/lifecycle.ts）
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ busy, since })); return; }
  if (req.method === 'POST' && req.url === '/run') {
    if (busy) { res.writeHead(409).end('busy'); return; }
    let body = '';
    for await (const c of req) body += c;
    let env;
    try { env = JSON.parse(body); } catch { res.writeHead(400).end('bad json'); return; }
    for (const k of ['SRC_URL', 'OUT_URL', 'DONE_URL']) if (typeof env[k] !== 'string') { res.writeHead(400).end(`missing ${k}`); return; }
    busy = true; since = Date.now();
    res.writeHead(202).end('started');
    // 送出最後結果之前就放掉忙碌：後台收到失敗會立刻重派，那時必須能接
    const idle = () => { busy = false; since = null; };
    run(env, { beforeReport: idle }).finally(idle);
    return;
  }
  res.writeHead(404).end();
}).listen(Number(process.env.PORT ?? 8080));
