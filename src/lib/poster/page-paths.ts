import { archiveYears } from '@/lib/timeline';
import { pageCards, toShareItem } from './pages';

/** 三個產圖端點共用：所有非內容頁的卡片。年份取自 archiveYears()，與年份頁同源。 */
export async function pagePaths() {
  return pageCards(await archiveYears()).map((c) => ({
    params: { slug: c.slug },
    props: { item: toShareItem(c) },
  }));
}
