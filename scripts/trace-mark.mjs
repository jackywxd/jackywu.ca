// 把「雪」字標 PNG 描成向量。
// 原圖是三色平塗（黑底 / 白實層 / 灰殘影層），全為多邊形，
// 所以用 marching squares 抽等值線 + Douglas–Peucker 化簡就能得到乾淨路徑。
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const SRC = 'src/assets/brand/seal-avatar.png';
const OUT = 'src/assets/brand/snow-mark.svg';
const VB = 1000;               // 目標 viewBox
const EPS = 0.45;             // 化簡容差（原圖像素）——水滴是唯一的曲線，留細一點

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;

const luma = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// 三色分層：> 200 是白實層，100..200 是灰殘影層
const maskOf = (lo, hi) => {
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = luma[i] > lo && luma[i] <= hi ? 1 : 0;
  return m;
};

// ---- marching squares：在 (W+1)×(H+1) 的格點上抽邊 ----
function contours(mask) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
  const segs = new Map();                       // "x,y" -> [終點...]
  const key = (x, y) => `${x},${y}`;
  const push = (a, b) => {
    const k = key(a[0], a[1]);
    if (!segs.has(k)) segs.set(k, []);
    segs.get(k).push(b);
  };
  // 每個 cell 的四角取樣，依 case 產生有向邊（內部在左手邊）
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x <= W; x++) {
      const tl = at(x - 1, y - 1), tr = at(x, y - 1), bl = at(x - 1, y), br = at(x, y);
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      const N = [x, y - 0.5], S = [x, y + 0.5], Wp = [x - 0.5, y], E = [x + 0.5, y];
      switch (c) {
        case 1:  push(S, Wp); break;
        case 2:  push(E, S);  break;
        case 3:  push(E, Wp); break;
        case 4:  push(N, E);  break;
        case 5:  push(N, Wp); push(S, E); break;
        case 6:  push(N, S);  break;
        case 7:  push(N, Wp); break;
        case 8:  push(Wp, N); break;
        case 9:  push(S, N);  break;
        case 10: push(Wp, S); push(E, N); break;
        case 11: push(E, N);  break;
        case 12: push(Wp, E); break;
        case 13: push(S, E);  break;
        case 14: push(Wp, S); break;
      }
    }
  }
  // 串成封閉環
  const loops = [];
  for (const [k, list] of segs) {
    while (list.length) {
      const start = k.split(',').map(Number);
      let cur = list.pop();
      const loop = [start, cur];
      for (let guard = 0; guard < 4_000_000; guard++) {
        const nk = key(cur[0], cur[1]);
        const nxt = segs.get(nk);
        if (!nxt || !nxt.length) break;
        cur = nxt.pop();
        loop.push(cur);
        if (cur[0] === start[0] && cur[1] === start[1]) break;
      }
      if (loop.length > 8) loops.push(loop);
    }
  }
  return loops;
}

// ---- 化簡 ----
const perp = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  if (d === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / d;
};
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perp(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

// 鞋帶公式：用來濾掉白/黑交界反鋸齒產生的 1px 細絲
const area = (l) => {
  let a = 0;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) a += l[j][0] * l[i][1] - l[i][0] * l[j][1];
  return Math.abs(a) / 2;
};
const MIN_AREA = 40;           // 原圖像素²

const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
const layers = {};
for (const [name, [lo, hi]] of Object.entries({ trail: [100, 200], solid: [200, 256] })) {
  const loops = contours(maskOf(lo, hi))
    .map((l) => rdp(l, EPS))
    .filter((l) => l.length > 3 && area(l) >= MIN_AREA);
  layers[name] = loops;
  for (const l of loops) for (const [x, y] of l) {
    if (x < bbox.x0) bbox.x0 = x; if (y < bbox.y0) bbox.y0 = y;
    if (x > bbox.x1) bbox.x1 = x; if (y > bbox.y1) bbox.y1 = y;
  }
}

// 置中並縮放到 VB，保持長寬比
const bw = bbox.x1 - bbox.x0, bh = bbox.y1 - bbox.y0;
const PAD = 0.04;
const s = (VB * (1 - 2 * PAD)) / Math.max(bw, bh);
const ox = (VB - bw * s) / 2 - bbox.x0 * s;
const oy = (VB - bh * s) / 2 - bbox.y0 * s;
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const toPath = (loops) =>
  loops.map((l) => 'M' + l.map(([x, y]) => `${fmt(x * s + ox)} ${fmt(y * s + oy)}`).join('L') + 'Z').join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" fill-rule="evenodd">
<path id="trail" d="${toPath(layers.trail)}"/>
<path id="solid" d="${toPath(layers.solid)}"/>
</svg>`;
writeFileSync(OUT, svg);

const rep = (n) => `${layers[n].length} loops, ${layers[n].reduce((a, l) => a + l.length, 0)} pts`;
console.log(`source ${W}x${H}  bbox ${fmt(bw)}x${fmt(bh)}`);
console.log(`trail: ${rep('trail')}`);
console.log(`solid: ${rep('solid')}`);
console.log(`wrote ${OUT}  ${(svg.length / 1024).toFixed(1)} KB`);
