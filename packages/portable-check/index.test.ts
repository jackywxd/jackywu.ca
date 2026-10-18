/**
 * 可移植套件的守門（scripts/verify-portable.mjs 對真實檔案跑）。
 * 防的失敗：packages/activity 悄悄 import 了這個 repo 的東西或沒宣告的套件，
 * 等到要搬去 wildrunner 才發現拆不開。
 */
import { describe, expect, it } from 'vitest';
import { portableViolations } from './index';

const pkg = { dependencies: { '@garmin/fitsdk': '^21' }, devDependencies: { vitest: '5' } };
const v = (files: Record<string, string>) => portableViolations(Object.entries(files).map(([path, text]) => ({ path, text })), pkg);

describe('portableViolations', () => {
  it('套件內的相對路徑、宣告過的依賴：通過', () => {
    expect(v({ 'index.ts': "import { Decoder } from '@garmin/fitsdk';\nimport { x } from './util';\nexport * from './sub/a';" })).toEqual([]);
  });
  it('跳出套件的相對路徑、repo 的別名、沒宣告的套件：各報一條，指出檔案與 import', () => {
    expect(v({
      'index.ts': "import { buildRoute } from '../gpx/index';\nimport { checkSlug } from '@content-rules';\nimport yaml from 'yaml';",
    })).toEqual([
      "index.ts：import '../gpx/index' 跳出了套件",
      "index.ts：import '@content-rules' 沒有在 package.json 宣告",
      "index.ts：import 'yaml' 沒有在 package.json 宣告",
    ]);
  });
  it('框架與執行環境：就算在 package.json 宣告了，payload、next、cloudflare:*、node:* 也一律不行（瀏覽器也要能跑）', () => {
    const declared = { dependencies: { payload: '3', next: '16', '@garmin/fitsdk': '21' } };
    const out = portableViolations([{ path: 'a.ts', text: "import 'payload';\nimport x from 'next/server';\nimport { env } from 'cloudflare:workers';\nimport fs from 'node:fs';" }], declared);
    expect(out).toHaveLength(4);
    for (const o of out) expect(o).toMatch(/框架或執行環境/);
  });
  it('測試檔可以用 devDependencies；原始碼不行', () => {
    expect(v({ 'a.test.ts': "import { it } from 'vitest';" })).toEqual([]);
    expect(v({ 'a.ts': "import { it } from 'vitest';" })).toEqual(["a.ts：import 'vitest' 是 devDependency，原始碼不能用"]);
  });
  it('動態 import 與 export from 也算；子路徑對到套件名', () => {
    expect(v({ 'a.ts': "const m = await import('../x');\nexport { y } from '@garmin/fitsdk/src/utils.js';" })).toEqual(["a.ts：import '../x' 跳出了套件"]);
  });
});
