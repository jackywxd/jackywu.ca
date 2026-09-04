import type { APIRoute } from 'astro';
import { shareablePaths } from '@/lib/poster/paths';
import { xhsLayout } from '@/lib/poster/layouts';
import { toJpeg } from '@/lib/poster/render';

/** 小紅書直式海報 1080×1440 */
export const getStaticPaths = shareablePaths;

export const GET: APIRoute = async ({ props }) => {
  const jpg = await toJpeg(xhsLayout(props.item), 1080, 1440, 84);
  return new Response(jpg, { headers: { 'Content-Type': 'image/jpeg' } });
};
