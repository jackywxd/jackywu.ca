/**
 * GPX → 距離 / 爬升 / 路線 SVG / 海拔剖面 SVG
 *
 * 只在「作者匯入路線」時跑一次，產物（yaml + svg）進 git。
 * 建置期不重新解析 —— 你的 TOR450 全段是 3.5MB，每次 build 都拆它是浪費。
 */

const R = 6371008.8; // 地球平均半徑 (m)
const rad = (d) => (d * Math.PI) / 180;

export function parse(xml) {
  const pts = [];
  // trkpt（軌跡）與 rtept（路線）都要吃 —— GaiaGPS 匯出的是 <rte>/<rtept>
  const re = /<(trkpt|rtept)[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"[^>]*>([\s\S]*?)<\/\1>|<(?:trkpt|rtept)[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[2] !== undefined) {
      const ele = /<ele>([-\d.]+)<\/ele>/.exec(m[4] ?? '');
      pts.push({ lat: +m[2], lon: +m[3], ele: ele ? +ele[1] : null });
    } else {
      pts.push({ lat: +m[5], lon: +m[6], ele: null });
    }
  }
  const name = /<(?:trk|rte)>[\s\S]*?<name>([^<]+)<\/name>/.exec(xml)?.[1]
            ?? /<metadata>[\s\S]*?<name>([^<]+)<\/name>/.exec(xml)?.[1]
            ?? null;
  const type = /<type>([^<]+)<\/type>/.exec(xml)?.[1] ?? null;
  return { name, type, pts };
}

/** haversine，公尺 */
export function dist(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * 累計爬升。
 * 直接把所有正高差加總會被 GPS 高度噪音灌水 2–3 倍，所以用遲滯門檻：
 * 只有累積上升超過 THRESH 公尺才記帳。這是業界標準做法，數字才會貼近 Strava。
 */
export function gain(pts, thresh = 5) {
  const eles = pts.map((p) => p.ele).filter((e) => e != null);
  if (eles.length < 2) return null;
  let total = 0;
  let ref = eles[0];
  for (const e of eles) {
    const d = e - ref;
    if (d >= thresh) { total += d; ref = e; }        // 確認是上升，記帳並前移基準
    else if (d <= -thresh) { ref = e; }              // 確認是下降，只前移基準
    // |d| < thresh 視為噪音，忽略
  }
  return Math.round(total);
}

/** 累計距離（公尺）+ 每點的里程，供剖面圖用 */
export function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { total: cum[cum.length - 1] ?? 0, cum };
}

/** Douglas–Peucker，在等距投影後的平面上做 */
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len === 0 ? Math.hypot(p.x - a.x, p.y - a.y)
                        : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

/** 路線輪廓 SVG。等距投影（在單一路線的尺度下誤差可忽略），自適應 viewBox */
export function routeSvg(pts, { size = 1000, pad = 40, target = 800 } = {}) {
  const lat0 = rad(pts.reduce((s, p) => s + p.lat, 0) / pts.length);
  const proj = pts.map((p) => ({ x: rad(p.lon) * Math.cos(lat0) * R, y: -rad(p.lat) * R }));
  const xs = proj.map((p) => p.x), ys = proj.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const s = (size - pad * 2) / span;

  // 容差自適應：目標點數 ~800
  let eps = span / 2000, simp = proj;
  for (let i = 0; i < 24 && simp.length > target; i++) { eps *= 1.4; simp = rdp(proj, eps); }

  const ox = pad + ((size - pad * 2) - (x1 - x0) * s) / 2 - x0 * s;
  const oy = pad + ((size - pad * 2) - (y1 - y0) * s) / 2 - y0 * s;
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const d = simp.map((p, i) => `${i ? 'L' : 'M'}${f(p.x * s + ox)} ${f(p.y * s + oy)}`).join('');
  return { d, viewBox: `0 0 ${size} ${size}`, points: simp.length };
}

/** 海拔剖面 SVG：x = 里程，y = 海拔。回傳封閉面積路徑 */
export function profileSvg(pts, cum, { w = 1000, h = 220, pad = 8 } = {}) {
  const idx = pts.map((p, i) => [i, p.ele]).filter(([, e]) => e != null);
  if (idx.length < 2) return null;
  const eles = idx.map(([, e]) => e);
  const [lo, hi] = [Math.min(...eles), Math.max(...eles)];
  const range = hi - lo || 1;
  const total = cum[cum.length - 1] || 1;

  const step = Math.max(1, Math.floor(idx.length / 600));
  const pt = [];
  for (let i = 0; i < idx.length; i += step) {
    const [j, e] = idx[i];
    pt.push([(cum[j] / total) * w, pad + (1 - (e - lo) / range) * (h - pad * 2)]);
  }
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const line = pt.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('');
  return { d: `${line}L${f(w)} ${h}L0 ${h}Z`, viewBox: `0 0 ${w} ${h}`, lo: Math.round(lo), hi: Math.round(hi) };
}
