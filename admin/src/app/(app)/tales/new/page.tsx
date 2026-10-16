import { ctx } from '../../../../lib/server';
import { NeedLogin } from '../../../../components/NeedLogin';
import { TaleEditor } from '../../../../components/TaleEditor';

export const dynamic = 'force-dynamic';

export default async function NewTale() {
  const { user } = await ctx();
  if (!user) return <NeedLogin />;
  const today = new Date().toLocaleDateString('sv', { timeZone: 'America/Vancouver' }); // YYYY-MM-DD，溫哥華的今天
  return <TaleEditor init={{ id: null, meta: { title: '', date: today, lang: 'zh-Hant', shareable: true, featured: false, tags: [] }, content: null, updatedAt: null, live: false }} />;
}
