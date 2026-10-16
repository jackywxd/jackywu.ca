import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildRoute } from '../../packages/gpx/index';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** 合成軌跡：繞圈上坡再下坡，海拔帶一點雜訊（測試累計爬升的遲滯門檻） */
function gpx(opts: { rte?: boolean; noEle?: boolean; n?: number } = {}): string {
  const n = opts.n ?? 400;
  const tag = opts.rte ? 'rtept' : 'trkpt';
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 2;
    const lat = 49.6 + Math.sin(t) * 0.05, lon = -123.1 + Math.cos(t) * 0.07;
    const ele = 400 + 1200 * Math.sin((i / (n - 1)) * Math.PI) + Math.sin(i * 2.7) * 3; // ±3m 雜訊
    pts.push(`<${tag} lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${opts.noEle ? '' : `<ele>${ele.toFixed(1)}</ele>`}</${tag}>`);
  }
  const body = opts.rte ? `<rte><name>Loop</name>${pts.join('')}</rte>` : `<trk><name>Loop</name><trkseg>${pts.join('')}</trkseg></trk>`;
  return `<?xml version="1.0"?><gpx version="1.1" creator="t"><metadata><name>Loop</name></metadata>${body}</gpx>`;
}

describe('buildRoute', () => {
  it('距離、爬升、海拔範圍合理', () => {
    const r = buildRoute(gpx());
    expect(r.name).toBe('Loop');
    expect(r.pointCount).toBe(400);
    expect(r.distanceKm).toBeGreaterThan(32); expect(r.distanceKm).toBeLessThan(35); // 橢圓：半徑約 5.3 km，周長約 33.3 km
    expect(r.gainM).toBeGreaterThan(1100); expect(r.gainM).toBeLessThan(1350);  // 真實爬升約 1200，雜訊不會把它灌到 2–3 倍
    expect(r.elevation!.hi).toBeGreaterThan(1500);
  });
  it('三張 SVG 都是合法的獨立 SVG，且不含腳本', () => {
    const r = buildRoute(gpx());
    for (const s of [r.svg.track, r.svg.thumb, r.svg.profile!]) {
      expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(s.endsWith('</svg>')).toBe(true);
      expect(s).not.toMatch(/<script|onload|javascript:/i);
    }
    expect(r.svg.thumb.length).toBeLessThan(r.svg.track.length); // 縮圖點數少得多
  });
  it('rtept（GaiaGPS 匯出的路線）也吃', () => expect(buildRoute(gpx({ rte: true })).pointCount).toBe(400));
  it('沒有高程：爬升是 null、沒有剖面，但距離與軌跡還在', () => {
    const r = buildRoute(gpx({ noEle: true }));
    expect(r.gainM).toBeNull(); expect(r.svg.profile).toBeNull(); expect(r.distanceKm).toBeGreaterThan(0);
  });
  it('是確定的：同一個輸入兩次輸出完全相同', () => expect(buildRoute(gpx())).toEqual(buildRoute(gpx())));
  it('點太少 → 明確的錯誤，不是 NaN', () => {
    expect(() => buildRoute('<gpx><trk><trkseg><trkpt lat="1" lon="2"></trkpt></trkseg></trk></gpx>')).toThrow(/至少需要 2 個/);
    expect(() => buildRoute('不是 xml')).toThrow();
  });
  it('XML 外部實體不會被展開（GPX 是外來檔案）', () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE g [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx><metadata><name>&x;</name></metadata><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.1" lon="1.1"/></trkseg></trk></gpx>`;
    const r = buildRoute(evil);
    expect(JSON.stringify(r)).not.toMatch(/root:|\/bin\//); // 解析器是正則，根本不處理實體
  });
});

describe('與舊的 scripts/ingest-gpx.mjs 逐位元組一致', () => {
  const tmps: string[] = [];
  afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }); });
  const args = ['--slug', 'loop', '--name', 'Loop', '--realm', 'run', '--region', '卑詩', '--date', '2026-08-22', '--badge', 'T · 50K · 2026'];

  function runIn(setup: (dir: string) => void, script: string): Record<string, string> {
    const dir = mkdtempSync(path.join(tmpdir(), 'gpx-eq-'));
    tmps.push(dir);
    setup(dir);
    writeFileSync(path.join(dir, 'in.gpx'), gpx());
    const r = spawnSync(process.execPath, [script, 'in.gpx', ...args], { cwd: dir, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const out: Record<string, string> = {};
    for (const f of ['yaml', 'svg', 'thumb.svg', 'profile.svg']) out[f] = readFileSync(path.join(dir, `src/content/routes/2026/loop.${f}`), 'utf8');
    return out;
  }

  it('yaml、軌跡、縮圖、剖面四個檔案內容完全相同', () => {
    const legacy = runIn((d) => cpSync(path.join(import.meta.dirname, 'fixtures/legacy-ingest/scripts'), path.join(d, 'scripts'), { recursive: true }), 'scripts/ingest-gpx.mjs');
    const current = runIn((d) => {
      cpSync(path.join(ROOT, 'scripts/ingest-gpx.mjs'), path.join(d, 'scripts/ingest-gpx.mjs'), { recursive: true });
      cpSync(path.join(ROOT, 'packages/gpx'), path.join(d, 'packages/gpx'), { recursive: true });
    }, 'scripts/ingest-gpx.mjs');
    expect(current).toEqual(legacy);
  });
  it('buildRoute 的輸出就是腳本寫出的檔案內容', () => {
    const r = buildRoute(gpx());
    const dir = mkdtempSync(path.join(tmpdir(), 'gpx-eq-'));
    tmps.push(dir);
    cpSync(path.join(ROOT, 'scripts/ingest-gpx.mjs'), path.join(dir, 'scripts/ingest-gpx.mjs'), { recursive: true });
    cpSync(path.join(ROOT, 'packages/gpx'), path.join(dir, 'packages/gpx'), { recursive: true });
    writeFileSync(path.join(dir, 'in.gpx'), gpx());
    expect(spawnSync(process.execPath, ['scripts/ingest-gpx.mjs', 'in.gpx', ...args], { cwd: dir }).status).toBe(0);
    expect(readFileSync(path.join(dir, 'src/content/routes/2026/loop.svg'), 'utf8')).toBe(r.svg.track);
    expect(readFileSync(path.join(dir, 'src/content/routes/2026/loop.profile.svg'), 'utf8')).toBe(r.svg.profile);
  });
});

import { parse as parseGpx } from '../../packages/gpx/gpx-core.mjs';
describe('大檔與不常見的寫法', () => {
  const pt = (i: number, closed: boolean) => closed
    ? `<trkpt lat="${(49 + i * 1e-5).toFixed(6)}" lon="-123.000000"><ele>${100 + (i % 50)}</ele></trkpt>`
    : `<trkpt lat="${(49 + i * 1e-5).toFixed(6)}" lon="-123.000000"/>`;
  const gpx = (pts: string[]) => `<?xml version="1.0"?><gpx><trk><name>t</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
  it('自閉合的 trkpt 夾在一般的之間：每一點都算到（先前會被下一個 </trkpt> 吞掉）', () => {
    const pts = [pt(0, true), pt(1, false), pt(2, false), pt(3, true)];
    expect(parseGpx(gpx(pts)).pts).toHaveLength(4);
  });
  it('20 萬點（一秒一點的 30 小時越野）不會堆疊溢位', () => {
    const big = gpx(Array.from({ length: 200_000 }, (_, i) => pt(i, true)));
    expect(() => buildRoute(big)).not.toThrow();
  });
  it('20 萬個自閉合點：線性時間（先前每個位置都往後掃到檔尾找 </trkpt>）', () => {
    const big = gpx(Array.from({ length: 200_000 }, (_, i) => pt(i, false)));
    const t0 = Date.now();
    expect(parseGpx(big).pts).toHaveLength(200_000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
