/**
 * 取回子集化用的原始字型。原始檔約 30MB，不進 git；
 * CI 用這支重現（可快取）。取不到就讓建置大聲失敗，不要靜默用舊的子集。
 */
import { mkdirSync, existsSync, statSync, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DIR = 'src/assets/fonts/source';
const FONTS = [
  { file: 'LXGWWenKaiTC-Regular.ttf',
    url: 'https://github.com/lxgw/LxgwWenKaiTC/releases/download/v1.522/LXGWWenKaiTC-Regular.ttf',
    license: 'OFL-1.1', minBytes: 14_000_000 },
  { file: 'NotoSerifTC[wght].ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/notoseriftc/NotoSerifTC%5Bwght%5D.ttf',
    license: 'OFL-1.1', minBytes: 15_000_000 },
];

mkdirSync(DIR, { recursive: true });
for (const f of FONTS) {
  const path = `${DIR}/${f.file}`;
  if (existsSync(path) && statSync(path).size >= f.minBytes) {
    console.log(`✓ ${f.file} 已存在 (${(statSync(path).size / 1048576).toFixed(1)} MB)`);
    continue;
  }
  process.stdout.write(`↓ ${f.file} … `);
  const res = await fetch(f.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${f.url} → HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  const size = statSync(path).size;
  // 拿到 HTML 錯誤頁而不是字型的話，大小會遠小於門檻 —— 要抓得出來
  if (size < f.minBytes) throw new Error(`${f.file} 只有 ${size} bytes，不像字型檔`);
  console.log(`${(size / 1048576).toFixed(1)} MB  [${f.license}]`);
}
