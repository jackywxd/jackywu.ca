import { readFileSync } from 'node:fs';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { Node } from './h';

/**
 * 唯一的產圖抽象層：satori → SVG → resvg → PNG/JPEG。
 *
 * satori 只吃 TTF/OTF/WOFF，不支援 WOFF2，所以這裡讀的是 build-fonts.mjs
 * 另外產的 poster.ttf（字元覆蓋已在該處驗過，缺字會讓建置失敗）。
 *
 * satori 預設 embedFont: true 會把文字轉成 <path>，所以 resvg 光柵化時
 * 不需要任何系統字型 —— 這正是這條管線能在 CI 的乾淨容器裡跑的原因。
 */
const FONT = readFileSync('src/assets/fonts/generated/poster.ttf');

const fonts = [
  { name: 'Poster', data: FONT, weight: 400 as const, style: 'normal' as const },
  { name: 'Poster', data: FONT, weight: 700 as const, style: 'normal' as const },
];

/** satori 的「多子節點 div 需要 display」錯誤不會說是哪一個 —— 自己走一遍找出來 */
function assertLayout(node: unknown, path = 'root'): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { type: string; props?: Record<string, any> };
  const kids: unknown[] = Array.isArray(n.props?.children) ? n.props!.children
    : n.props?.children != null ? [n.props.children] : [];
  if (n.type === 'div' && !n.props?.style?.display) {
    throw new Error(`版面錯誤：${path} 的 <div> 缺 display（空 div 也要）。style=${JSON.stringify(n.props?.style)}`);
  }
  kids.forEach((k, i) => assertLayout(k, `${path} > ${(k as any)?.type ?? typeof k}[${i}]`));
}

export async function toSvg(node: Node, width: number, height: number) {
  assertLayout(node);
  try {
    return await satori(node as Parameters<typeof satori>[0], { width, height, fonts });
  } catch (e) {
    // satori 的錯誤不說是哪個節點 —— 把樹倒出來（只留 type 與 display）
    const shape = (n: any, d = 0): any => {
      if (!n || typeof n !== 'object') return typeof n === 'string' ? `"${String(n).slice(0, 12)}"` : n;
      const kids = Array.isArray(n.props?.children) ? n.props.children
        : n.props?.children != null ? [n.props.children] : [];
      return { t: n.type, disp: n.props?.style?.display ?? '❌MISSING', n: kids.length,
               k: d > 4 ? '…' : kids.map((x: any) => shape(x, d + 1)) };
    };
    console.error('SATORI TREE >>>', JSON.stringify(shape(node), null, 1).slice(0, 3000));
    throw e;
  }
}

// 回傳 Uint8Array<ArrayBuffer>：Buffer / Uint8Array<ArrayBufferLike> 不是合法的 Response body 型別
export async function toPng(node: Node, width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const svg = await toSvg(node, width, height);
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
}

/** resvg 只輸出 PNG；JPEG 由 sharp 轉。微信與小紅書要 JPEG（X5 內核對 WebP 不穩） */
export async function toJpeg(node: Node, width: number, height: number, quality = 82): Promise<Uint8Array<ArrayBuffer>> {
  const png = await toPng(node, width, height);
  const sharp = (await import('sharp')).default;
  return new Uint8Array(await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer());
}
