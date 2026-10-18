import { ValidationError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook } from 'payload';
import { validateTale } from '@content-rules';
import { planTaleRedirects, taleUrl } from '../../lib/redirects';

/**
 * 發佈前的完整檢查。草稿不擋（寫到一半很正常），
 * 但一旦要寫成 published，任何不合格的欄位都以「欄位錯誤」回報，畫面上找得到。
 */
export const validateOnPublish: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  if (data._status !== 'published') return data;
  const m = { ...(originalDoc ?? {}), ...data } as Record<string, unknown>;
  const errors = validateTale({
    title: String(m.title ?? ''),
    slug: String(m.slug ?? ''),
    date: String(m.date ?? ''),
    realm: String(m.realm ?? ''),
    excerpt: String(m.excerpt ?? ''),
    verse: (m.verse as string | null) ?? null,
    shareable: (m.shareable as boolean | null) ?? null,
    hero: m.hero,
    heroAlt: (m.heroAlt as string | null) ?? null,
    heroRoute: (m.heroRoute as boolean | null) ?? null,
    route: m.route,
  });
  if (errors.length) {
    throw new ValidationError({
      collection: 'tales',
      errors: errors.map((e) => ({ path: e.field, message: e.message })),
    });
  }
  return data;
};

/** 已發佈的文章改了 slug／日期 → 自動記下 301，並整理轉址鏈 */
export const recordRedirects: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  if (previousDoc?._status !== 'published' || doc._status !== 'published') return doc;
  if (previousDoc.slug === doc.slug && previousDoc.date === doc.date) return doc;

  const existing = await req.payload.find({
    collection: 'redirects', limit: 1000, depth: 0, pagination: false, req,
  });
  const plan = planTaleRedirects({
    before: { date: previousDoc.date, slug: previousDoc.slug },
    after: { date: doc.date, slug: doc.slug },
    existing: existing.docs.map((d) => ({ from: d.from, to: d.to })),
  });
  for (const r of plan.create) {
    await req.payload.create({ collection: 'redirects', data: { ...r, reason: `改網址：${taleUrl(previousDoc.date, previousDoc.slug)}` }, req });
  }
  for (const r of plan.retarget) {
    const hit = existing.docs.find((d) => d.from === r.from);
    if (hit) await req.payload.update({ collection: 'redirects', id: hit.id, data: { to: r.to }, req });
  }
  for (const from of plan.remove) {
    const hit = existing.docs.find((d) => d.from === from);
    if (hit) await req.payload.delete({ collection: 'redirects', id: hit.id, req });
  }
  return doc;
};
