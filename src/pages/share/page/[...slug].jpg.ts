import type { APIRoute } from 'astro';
import { pagePaths } from '@/lib/poster/page-paths';
import { xhsLayout } from '@/lib/poster/layouts';
import { toJpeg } from '@/lib/poster/render';
export const getStaticPaths = pagePaths;
export const GET: APIRoute = async ({ props }) =>
  new Response(await toJpeg(xhsLayout(props.item), 1080, 1440, 84), { headers: { 'Content-Type': 'image/jpeg' } });
