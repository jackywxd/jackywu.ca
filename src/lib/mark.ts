import raw from '@/assets/brand/snow-mark.svg?raw';

/**
 * 「雪」字標的兩層路徑。
 * trail = 灰色殘影層（帶箭頭，代表行進過的軌跡）
 * solid = 白色實層（代表現在）
 * 兩層錯位構造本身就是一台時光機 —— 開場動畫先畫殘影，實層再落上。
 */
const pick = (id: string) => {
  const m = raw.match(new RegExp(`<path id="${id}" d="([^"]+)"`));
  if (!m) throw new Error(`snow-mark.svg 缺少 path#${id} —— 重跑 scripts/trace-mark.mjs`);
  return m[1]!;
};

export const mark = { trail: pick('trail'), solid: pick('solid') } as const;
export const MARK_VIEWBOX = '0 0 1000 1000';
