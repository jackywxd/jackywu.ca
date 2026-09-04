import { h, type Node } from './h';
import { C, REALM_ACCENT } from './theme';
import { site } from '@/lib/site';
import { mark } from '@/lib/mark';
import type { ShareItem } from './item';

const F = 'Poster';

/** 白文印：實心朱砂方印、字反白挖空。與網站上的 SnowMark variant="seal" 同形。 */
function chopDataUri(size: number, color = C.seal, cut = C.paper) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="${size}" height="${size}">` +
    `<mask id="c"><rect width="1000" height="1000" fill="#fff"/>` +
    `<g transform="translate(160 160) scale(0.68)">` +
    `<path d="${mark.trail}" fill="#000" fill-rule="evenodd"/>` +
    `<path d="${mark.solid}" fill="#000" fill-rule="evenodd"/></g></mask>` +
    `<rect width="1000" height="1000" rx="70" fill="${color}"/>` +
    `<rect width="1000" height="1000" rx="70" fill="${cut}" mask="url(#c)" style="mix-blend-mode:normal"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** 路線輪廓，當海報主視覺 */
function trackDataUri(d: string, size: number, color: string, w = 9) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="${size}" height="${size}">` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ...props 必須放在 style 之前，否則它自己的 style 會把合併好的 display:flex 蓋掉
const row = (props: Record<string, unknown>, ...kids: Node[]) =>
  h('div', { ...props, style: { display: 'flex', ...(props.style as object) } }, ...kids);

/** 落款：印 + 站名 + 署名。三種版面共用 */
function signature(scale: number, accent: string) {
  return row({ style: { alignItems: 'center', gap: 12 * scale } },
    h('img', { src: chopDataUri(Math.round(34 * scale)), width: Math.round(34 * scale), height: Math.round(34 * scale) }),
    h('div', { style: { display: 'flex', flexDirection: 'column' } },
      h('div', { style: { fontSize: 20 * scale, color: C.ink, letterSpacing: 3 * scale } }, site.name),
      h('div', { style: { fontSize: 13 * scale, color: C.stone, letterSpacing: 4 * scale, marginTop: 3 * scale } }, site.signature),
    ),
  );
}

const statBlock = (s: { k: string; v: string }, scale: number) =>
  h('div', { style: { display: 'flex', flexDirection: 'column', marginRight: 34 * scale } },
    h('div', { style: { fontSize: 15 * scale, color: C.stone, letterSpacing: 2 * scale } }, s.k),
    h('div', { style: { fontSize: 34 * scale, color: C.ink, marginTop: 2 * scale } }, s.v),
  );

/* ─────────── 橫版 1200×630：og:image / Twitter / Telegram ─────────── */
export function ogLayout(it: ShareItem): Node {
  const accent = REALM_ACCENT[it.realm] ?? C.seal;
  return h('div', {
    style: {
      width: 1200, height: 630, display: 'flex', flexDirection: 'column',
      backgroundColor: C.paper, fontFamily: F, padding: 64,
    },
  },
    // 主區：左文字 / 右視覺
    h('div', { style: { display: 'flex', flexGrow: 1, minHeight: 0 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', width: 700 } },
        row({ style: { alignItems: 'center', gap: 14 } },
          h('div', { style: { fontSize: 20, color: accent, letterSpacing: 4 } }, it.realmLabel),
          it.badge && h('div', { style: { fontSize: 18, color: C.stone, letterSpacing: 3 } }, it.badge),
        ),
        h('div', { style: { fontSize: it.title.length > 18 ? 50 : 62, color: C.ink, marginTop: 18, lineHeight: 1.25 } }, it.title),
        it.hook && h('div', { style: { fontSize: 25, color: C.soft, marginTop: 20, lineHeight: 1.7 } }, it.hook.slice(0, 44)),
        it.stats.length > 0 && h('div', { style: { display: 'flex', marginTop: 'auto' } },
          ...it.stats.slice(0, 3).map((st) => statBlock(st, 0.86)),
        ),
      ),
      h('div', { style: { display: 'flex', width: 372, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' } },
        it.track
          ? h('img', { src: trackDataUri(it.track, 320, C.ink, 7), width: 320, height: 320 })
          : h('div', { style: { fontSize: 280, color: C.ink, opacity: 0.07, lineHeight: 1 } }, it.glyph),
      ),
    ),
    // 界欄 + 落款
    h('div', { style: { height: 1, backgroundColor: C.edge, marginTop: 26 } }),
    h('div', { style: { display: 'flex', alignItems: 'flex-end', marginTop: 22 } },
      signature(1, accent),
      h('div', { style: { marginLeft: 'auto', fontSize: 18, color: C.stone } }, it.dateLabel),
    ),
  );
}

/* ─────────── 方版 600×600：微信站內縮圖 ───────────
   微信會把它再縮到約 200×200，所以字要夠大、對比要夠強。 */
export function wxLayout(it: ShareItem): Node {
  const accent = REALM_ACCENT[it.realm] ?? C.seal;
  return h('div', {
    style: {
      width: 600, height: 600, display: 'flex', flexDirection: 'column',
      backgroundColor: C.paper, fontFamily: F, padding: 48, position: 'relative',
    },
  },
    h('div', { style: { fontSize: 22, color: accent, letterSpacing: 5 } }, it.realmLabel),
    h('div', {
      style: {
        fontSize: it.title.length > 14 ? 52 : 62, color: C.ink,
        marginTop: 14, lineHeight: 1.3, maxHeight: 250, overflow: 'hidden',
      },
    }, it.title),
    it.track
      ? h('div', { style: { display: 'flex', marginTop: 'auto', justifyContent: 'center' } },
          h('img', { src: trackDataUri(it.track, 210, C.ink, 10), width: 210, height: 210 }))
      : h('div', { style: { display: 'flex', marginTop: 'auto', justifyContent: 'center', fontSize: 210, color: C.ink, opacity: 0.08, lineHeight: 1 } }, it.glyph),
    h('div', { style: { display: 'flex', marginTop: 'auto', alignItems: 'center' } },
      signature(0.95, accent),
      it.stats[0] && h('div', { style: { marginLeft: 'auto', fontSize: 30, color: C.ink } }, it.stats[0].v),
    ),
  );
}

/* ─────────── 直版 1080×1440：小紅書海報 ───────────
   絕不放網址、二維碼，或任何可被 OCR 出來的導流文字。
   品牌承載交給印章與「追雲逐雪」—— 那是名字，不是連結。 */
export function xhsLayout(it: ShareItem): Node {
  const accent = REALM_ACCENT[it.realm] ?? C.seal;
  const SAFE = 116;   // 上下各留 8% 安全邊，小紅書 3:4 版位不會裁到關鍵元素
  return h('div', {
    style: {
      width: 1080, height: 1440, display: 'flex', flexDirection: 'column',
      backgroundColor: C.paper, fontFamily: F, position: 'relative',
      paddingTop: SAFE, paddingBottom: SAFE, paddingLeft: 92, paddingRight: 92,
    },
  },
    // 匾額
    row({ style: { alignItems: 'center', gap: 16 } },
      h('div', { style: { fontSize: 34, color: C.ink, letterSpacing: 8 } }, site.name),
      h('div', { style: { flexGrow: 1, height: 1, backgroundColor: C.edge } }),
      h('div', { style: { fontSize: 22, color: accent, letterSpacing: 5 } }, it.realmLabel),
    ),

    // 主視覺
    h('div', { style: { display: 'flex', marginTop: 64, justifyContent: 'center', alignItems: 'center', height: 460 } },
      it.track
        ? h('img', { src: trackDataUri(it.track, 460, C.ink, 6), width: 460, height: 460 })
        : h('div', { style: { fontSize: 420, color: C.ink, opacity: 0.07, lineHeight: 1 } }, it.glyph),
    ),

    // 金句
    it.hook && h('div', {
      style: { fontSize: 46, color: C.ink, marginTop: 56, lineHeight: 1.85, letterSpacing: 2 },
    }, it.hook.slice(0, 34)),

    // 標題
    h('div', { style: { fontSize: 30, color: C.soft, marginTop: 30, lineHeight: 1.6 } }, it.title),

    // 數據
    it.stats.length > 0 && h('div', { style: { display: 'flex', marginTop: 44 } },
      ...it.stats.slice(0, 3).map((s) => statBlock(s, 1.15)),
    ),

    // 落款。日期放進同一列，不用絕對定位 —— 絕對定位跟 marginTop:auto 會打架
    h('div', { style: { display: 'flex', marginTop: 'auto', alignItems: 'flex-end' } },
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        signature(1.35, accent),
        h('div', { style: { fontSize: 22, color: C.stone, marginTop: 18, letterSpacing: 2 } }, it.dateLabel),
      ),
      h('div', { style: { marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' } },
        // satori 沒有 writing-mode，直排就一個字一行堆起來
        ...[...site.signature].map((ch) =>
          h('div', { style: { fontSize: 26, color: C.stone, lineHeight: 1.55 } }, ch)),
      ),
    ),
  );
}
