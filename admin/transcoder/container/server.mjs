// 容器的入口：Worker 用 POST /run 帶著環境參數叫它開工；回 202，結果由 transcode.mjs 直接回報給後台。
import http from 'node:http';
import { run } from './transcode.mjs';

let busy = false;
http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200).end('ok'); return; }
  if (req.method === 'POST' && req.url === '/run') {
    if (busy) { res.writeHead(409).end('busy'); return; }
    let body = '';
    for await (const c of req) body += c;
    let env;
    try { env = JSON.parse(body); } catch { res.writeHead(400).end('bad json'); return; }
    for (const k of ['SRC_URL', 'OUT_URL', 'DONE_URL']) if (typeof env[k] !== 'string') { res.writeHead(400).end(`missing ${k}`); return; }
    busy = true;
    res.writeHead(202).end('started');
    run(env).finally(() => { busy = false; });
    return;
  }
  res.writeHead(404).end();
}).listen(Number(process.env.PORT ?? 8080));
