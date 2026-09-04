import type { APIRoute } from 'astro';
import { shareablePaths } from '@/lib/poster/paths';
import { ogLayout } from '@/lib/poster/layouts';
import { toPng } from '@/lib/poster/render';

export const getStaticPaths = shareablePaths;

export const GET: APIRoute = async ({ props }) => {
  const png = await toPng(ogLayout(props.item), 1200, 630);
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
