import { notFound } from 'next/navigation';
import { ctx } from '../../../../lib/server';
import { NeedLogin } from '../../../../components/NeedLogin';
import { TaleEditor } from '../../../../components/TaleEditor';

export const dynamic = 'force-dynamic';

export default async function EditTale({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { payload, user } = await ctx();
  if (!user) return <NeedLogin />;
  if (!/^\d+$/.test(id)) notFound();
  let doc;
  try { doc = await payload.findByID({ collection: 'tales', id, draft: true, depth: 0, overrideAccess: true }); } catch { notFound(); }
  const live = (await payload.count({ collection: 'tales', where: { id: { equals: id }, _status: { equals: 'published' } }, overrideAccess: true })).totalDocs > 0;
  const { content, ...meta } = doc as unknown as { content: never; title: string } & Record<string, unknown>;
  return <TaleEditor init={{ id, meta: meta as never, content: (content ?? null) as never, updatedAt: String((doc as { updatedAt: string }).updatedAt), live }} />;
}
