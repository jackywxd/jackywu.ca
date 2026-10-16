import { ctx } from '../../../../lib/server';
import { NeedLogin } from '../../../../components/NeedLogin';
import { ImportTale } from '../../../../components/ImportTale';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const { user } = await ctx();
  if (!user) return <NeedLogin />;
  return <ImportTale />;
}
