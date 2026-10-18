/**
 * 可移植套件（packages/activity…）的守門：每一個 import 都必須留在套件裡，或是 package.json 宣告過的依賴。
 * 框架與執行環境（payload、next、cloudflare:*、node:*）一律不行：套件要能原樣搬到別的專案，也要能在瀏覽器裡跑。
 * scripts/verify-portable.mjs 對真實的檔案跑這裡的規則。
 */
export interface Pkg { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;
const FORBIDDEN = /^(?:node:|cloudflare:|payload(?:\/|$)|@payloadcms\/|next(?:\/|$))/;
const isTest = (p: string) => /\.test\.[cm]?[jt]sx?$/.test(p);
/** 'a/b/c' → 'a'；'@s/a/b' → '@s/a' */
const pkgName = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);

function escapes(file: string, spec: string): boolean {
  const parts = file.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') { if (!parts.length) return true; parts.pop(); }
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return false;
}

/** files 的 path 是相對於套件根目錄的路徑 */
export function portableViolations(files: { path: string; text: string }[], pkg: Pkg): string[] {
  const deps = new Set(Object.keys(pkg.dependencies ?? {}));
  const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
  const out: string[] = [];
  for (const f of files) {
    for (const m of f.text.matchAll(IMPORT)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      if (spec.startsWith('.')) {
        if (escapes(f.path, spec)) out.push(`${f.path}：import '${spec}' 跳出了套件`);
        continue;
      }
      if (FORBIDDEN.test(spec)) { out.push(`${f.path}：import '${spec}' 是框架或執行環境，可移植的套件不能用`); continue; }
      const name = pkgName(spec);
      if (deps.has(name)) continue;
      if (dev.has(name)) { if (!isTest(f.path)) out.push(`${f.path}：import '${spec}' 是 devDependency，原始碼不能用`); continue; }
      out.push(`${f.path}：import '${spec}' 沒有在 package.json 宣告`);
    }
  }
  return out;
}
