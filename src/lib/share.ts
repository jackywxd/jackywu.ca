import { site } from './site';

export interface SharePayload {
  /** 小紅書文案：絕對不含網址 */
  xhs: string;
  /** 微信文案：含網址 */
  wechat: string;
}

/**
 * 兩份剪貼簿文案，刻意分成兩顆按鈕。
 *
 * 小紅書 2026 規則主動壓制站外導流 —— 外鏈、微信號、二維碼、聯絡方式，
 * 連圖片裡被 OCR 出來的文字都算，輕則限流重則封號。所以小紅書那份
 * 不放網址、不放任何導流字樣；品牌承載完全交給海報上的印章與「追雲逐雪」，
 * 那是名字，不是連結。
 */
export function sharePayload(opts: {
  title: string;
  hook: string;
  stats?: string;
  tags: string[];
  url: string;
}): SharePayload {
  const tags = opts.tags.slice(0, 6).map((t) => `#${t.replace(/\s+/g, '')}`).join(' ');
  const xhs = [opts.title, '', opts.hook, opts.stats, '', tags]
    .filter((l) => l !== undefined && l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const wechat = [opts.title, opts.hook, opts.url].filter(Boolean).join('\n');
  return { xhs, wechat };
}

export const absolute = (path: string) => new URL(path, site.url).href;
