/** 從後台（Payload REST，經 Access 服務憑證）讀已發佈的內容。fetch-content 與 export-content 共用。 */
import { writeFileSync } from 'node:fs';

export async function loadLive() {
  const base = process.env.ADMIN_URL;
  const id = process.env.CF_ACCESS_CLIENT_ID, secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!base || !id || !secret) throw new Error('live 模式需要 ADMIN_URL、CF_ACCESS_CLIENT_ID、CF_ACCESS_CLIENT_SECRET');
  const headers = { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret, accept: 'application/json' };
  const get = async (path) => {
    const r = await fetch(new URL(path, base), { headers, redirect: 'manual' });
    // Access 沒放行時會 302 去登入頁；這不是「內容是空的」，是設定壞了，要大聲說
    if (r.status >= 300 && r.status < 400) throw new Error(`${path} 被導向 ${r.headers.get('location')}：Access 服務憑證沒有被接受`);
    if (!r.ok) throw new Error(`${path} 回 ${r.status}`);
    return r;
  };
  const all = async (col, extra = '') =>
    (await (await get(`/api/${col}?limit=0&pagination=false&depth=0${extra}`)).json()).docs;
  const published = '&where[_status][equals]=published';
  const corpus = {
    tales: await all('tales', published), pages: await all('pages', published), routes: await all('routes', published),
    reels: await all('reels', published), media: await all('media'), redirects: await all('redirects'),
  };
  const media = async (mid, dest) => {
    const doc = corpus.media.find((m) => String(m.id) === String(mid));
    const r = await get(`/api/media/file/${encodeURIComponent(doc.filename)}`);
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  };
  // 這一筆請求要建置的內容：後台在送出那一刻拍的快照（含還沒上線的依賴）。CI 讀不到版本表，也不需要
  const snapshot = async (requestId) => (await (await get(`/api/publish/snapshot?requestId=${encodeURIComponent(requestId)}`)).json()).snapshot;
  return { corpus, media, snapshot };
}
