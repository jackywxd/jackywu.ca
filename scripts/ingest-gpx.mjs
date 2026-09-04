/**
 * 把一個 GPX 匯入成 routes 條目：算數據、產路線 SVG 與海拔剖面 SVG、寫 yaml。
 * 用法：
 *   node scripts/ingest-gpx.mjs <file.gpx> --slug s --name "名" --realm run \
 *        --region "地區" --date 2026-08-22 [--badge "UTW · 100K · 2026"] \
 *        [--result "完賽"] [--elapsed PT21H47M] [--note "..."] [--dry]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse, measure, gain, routeSvg, profileSvg } from './lib/gpx.mjs';

const [, , file, ...rest] = process.argv;
if (!file) { console.error('需要 GPX 檔路徑'); process.exit(1); }
const arg = (k, d) => { const i = rest.indexOf(`--${k}`); return i === -1 ? d : rest[i + 1]; };
const has = (k) => rest.includes(`--${k}`);

const { name: gpxName, type, pts } = parse(readFileSync(file, 'utf8'));
if (pts.length < 2) { console.error('GPX 沒有可用的 trkpt'); process.exit(1); }

const { total, cum } = measure(pts);
const g = gain(pts);
const route = routeSvg(pts);
const prof = profileSvg(pts, cum);

const distanceKm = Math.round((total / 1000) * 10) / 10;
console.log(`檔案      ${file}`);
console.log(`GPX 名稱  ${gpxName ?? '(無)'}${type ? ` [${type}]` : ''}`);
console.log(`原始點數  ${pts.length}  →  簡化後 ${route.points}`);
console.log(`距離      ${distanceKm} km`);
console.log(`累計爬升  ${g ?? '(無高程)'} m`);
if (prof) console.log(`海拔      ${prof.lo} – ${prof.hi} m`);

if (has('dry')) process.exit(0);

const slug = arg('slug');
if (!slug) { console.error('\n需要 --slug'); process.exit(1); }

const svgPath = `src/content/routes/${slug}.svg`;
mkdirSync(dirname(svgPath), { recursive: true });
writeFileSync(svgPath,
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${route.viewBox}" fill="none">
<path id="track" d="${route.d}" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);

if (prof) {
  writeFileSync(`src/content/routes/${slug}.profile.svg`,
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${prof.viewBox}" preserveAspectRatio="none">
<path id="profile" d="${prof.d}" fill="currentColor"/>
</svg>`);
}

const q = (s) => (s == null ? null : `'${String(s).replace(/'/g, "''")}'`);
const lines = [
  `name: ${q(arg('name', gpxName))}`,
  arg('nameEn') ? `nameEn: ${q(arg('nameEn'))}` : null,
  `realm: ${arg('realm', 'run')}`,
  `date: ${arg('date')}`,
  `region: ${q(arg('region', ''))}`,
  `gpx: ${slug}.gpx`,
  `distanceKm: ${distanceKm}`,
  g != null ? `gainM: ${g}` : null,
  arg('elapsed') ? `elapsed: ${arg('elapsed')}` : null,
  arg('result') ? `result: ${q(arg('result'))}` : null,
  arg('badge') ? `badge: ${q(arg('badge'))}` : null,
  arg('note') ? `note: ${q(arg('note'))}` : null,
].filter(Boolean);
writeFileSync(`src/content/routes/${slug}.yaml`, lines.join('\n') + '\n');
console.log(`\n寫入 src/content/routes/${slug}.{yaml,svg${prof ? ',profile.svg' : ''}}`);
