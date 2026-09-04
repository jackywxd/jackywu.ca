import type { APIRoute } from 'astro';
import { pagePaths } from '@/lib/poster/page-paths';
import { wxLayout } from '@/lib/poster/layouts';
import { toJpeg } from '@/lib/poster/render';
export const getStaticPaths = pagePaths;
export const GET: APIRoute = async ({ props }) =>
  new Response(await toJpeg(wxLayout(props.item), 600, 600, 78), { headers: { 'Content-Type': 'image/jpeg' } });
