// 本機 E2E 的假 GitHub：只實作後台會呼叫的三個端點，並記錄每一次 dispatch 供測試斷言。
import http from 'node:http';

const port = Number(process.env.FAKE_GITHUB_PORT);
const dispatches = [];
let failNext = 0;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
  const json = (status, o) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const auth = req.headers.authorization ?? '';

  if (url.pathname === '/__calls') return json(200, { dispatches });
  if (url.pathname === '/__fail-next' && req.method === 'POST') { failNext = Number(url.searchParams.get('n') ?? 1); return json(200, { failNext }); }
  if (url.pathname === '/__reset' && req.method === 'POST') { dispatches.length = 0; failNext = 0; return json(200, {}); }

  if (/^\/app\/installations\/\d+\/access_tokens$/.test(url.pathname) && req.method === 'POST') {
    if (!auth.startsWith('Bearer ey')) return json(401, { message: 'need app jwt' });
    return json(201, { token: 'ghs_fake', expires_at: new Date(Date.now() + 3600_000).toISOString() });
  }
  if (/^\/repos\/[^/]+\/[^/]+\/actions\/workflows\/publish\.yml\/dispatches$/.test(url.pathname) && req.method === 'POST') {
    if (auth !== 'token ghs_fake') return json(401, { message: 'bad token' });
    if (failNext > 0) { failNext--; return json(503, { message: 'unavailable' }); }
    // 和真的 GitHub 一樣：inputs 只收字串，ref 必填
    const { ref, inputs } = JSON.parse(body);
    if (typeof ref !== 'string' || !inputs || Object.values(inputs).some((v) => typeof v !== 'string')) return json(422, { message: 'bad inputs' });
    dispatches.push(JSON.parse(inputs.request));
    res.writeHead(204); return res.end();
  }
  if (/^\/repos\/[^/]+\/[^/]+\/actions\/workflows\/publish\.yml\/runs$/.test(url.pathname)) return json(200, { workflow_runs: [] });
  json(404, { message: 'not found', path: url.pathname });
}).listen(port, '127.0.0.1', () => console.log(`fake github on ${port}`));
