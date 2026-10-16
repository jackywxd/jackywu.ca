import { ctx } from '../../../lib/server';
import { NeedLogin } from '../../../components/NeedLogin';
import { MediaLibrary } from '../../../components/MediaLibrary';
import { VideoLibrary } from '../../../components/VideoLibrary';

export const dynamic = 'force-dynamic';

export default async function MediaPage() {
  const { user } = await ctx();
  if (!user) return <NeedLogin />;
  return <><h1 className="h1">媒體</h1><MediaLibrary /><VideoLibrary /></>;
}
