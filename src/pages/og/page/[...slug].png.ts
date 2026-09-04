import type { APIRoute } from 'astro';
import { pagePaths } from '@/lib/poster/page-paths';
import { ogLayout } from '@/lib/poster/layouts';
import { toPng } from '@/lib/poster/render';
export const getStaticPaths = pagePaths;
export const GET: APIRoute = async ({ props }) =>
  new Response(await toPng(ogLayout(props.item), 1200, 630), { headers: { 'Content-Type': 'image/png' } });
