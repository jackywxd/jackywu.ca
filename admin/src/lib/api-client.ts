import type { MediaItem } from './media-client';

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} 回 ${r.status}`);
  return r.json() as Promise<T>;
}

export interface Option { id: number | string; label: string }

export async function listMedia(limit = 60): Promise<MediaItem[]> {
  return (await getJson<{ docs: MediaItem[] }>(`/api/media?limit=${limit}&sort=-createdAt&depth=0&where[kind][equals]=img`)).docs;
}
export async function listReels(): Promise<Option[]> {
  const j = await getJson<{ docs: { id: number; title: string; videoId: string }[] }>('/api/reels?limit=200&depth=0&draft=true');
  return j.docs.map((d) => ({ id: d.id, label: `${d.title}（${d.videoId}）` }));
}
export async function listRoutes(): Promise<Option[]> {
  const j = await getJson<{ docs: { id: number; name: string; slug: string; distanceKm?: number }[] }>('/api/routes?limit=200&depth=0&draft=true');
  return j.docs.map((d) => ({ id: d.id, label: `${d.name}${d.distanceKm ? `・${d.distanceKm} km` : ''}` }));
}
