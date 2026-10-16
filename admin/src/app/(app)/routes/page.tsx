import { ctx } from '../../../lib/server';
import { NeedLogin } from '../../../components/NeedLogin';
import { RoutesPage } from '../../../components/RoutesPage';

export const dynamic = 'force-dynamic';

export default async function Routes() {
  const { user } = await ctx();
  if (!user) return <NeedLogin />;
  return <RoutesPage />;
}
