import type { APIRoute } from 'astro';
import { shareablePaths } from '@/lib/poster/paths';
import { wxLayout } from '@/lib/poster/layouts';
import { toJpeg } from '@/lib/poster/render';

export const getStaticPaths = shareablePaths;

/** 微信站內分享縮圖。必須是 JPEG —— 舊版 X5 內核對 WebP 支援不穩 */
export const GET: APIRoute = async ({ props }) => {
  const jpg = await toJpeg(wxLayout(props.item), 600, 600, 78);
  return new Response(jpg, { headers: { 'Content-Type': 'image/jpeg' } });
};
