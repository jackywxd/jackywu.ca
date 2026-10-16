/**
 * GPX → 距離／爬升／路線 SVG／海拔剖面 SVG。
 * 瀏覽器、後台 Worker 與 scripts/ingest-gpx.mjs 共用同一份，數字與 SVG 逐位元組一致。
 * 解析與幾何在 gpx-core.mjs（沿用原本的實作，不重寫）。
 */
import { parse, measure, gain, routeSvg, profileSvg } from './gpx-core.mjs';

export interface RouteBuild {
  name: string | null;
  type: string | null;
  pointCount: number;
  distanceKm: number;
  gainM: number | null;
  elevation: { lo: number; hi: number } | null;
  svg: { track: string; thumb: string; profile: string | null };
}

/** 與 scripts/ingest-gpx.mjs 原本寫出的檔案內容完全相同 */
export function buildRoute(xml: string): RouteBuild {
  const { name, type, pts } = parse(xml) as { name: string | null; type: string | null; pts: unknown[] };
  if (pts.length < 2) throw new Error('GPX 裡沒有足夠的軌跡點（至少需要 2 個 trkpt 或 rtept）');
  const { total, cum } = measure(pts);
  const route = routeSvg(pts);
  // 卡片縮圖只有 92px，用不到 800 個點
  const thumb = routeSvg(pts, { target: 90, pad: 60 });
  const prof = profileSvg(pts, cum);
  return {
    name, type, pointCount: pts.length,
    distanceKm: Math.round((total / 1000) * 10) / 10,
    gainM: gain(pts) as number | null,
    elevation: prof ? { lo: prof.lo, hi: prof.hi } : null,
    svg: {
      track: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${route.viewBox}" fill="none">\n<path id="track" d="${route.d}" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>\n</svg>`,
      thumb: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${thumb.viewBox}" fill="none">\n<path d="${thumb.d}" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>\n</svg>`,
      profile: prof ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${prof.viewBox}" preserveAspectRatio="none">\n<path id="profile" d="${prof.d}" fill="currentColor"/>\n</svg>` : null,
    },
  };
}
