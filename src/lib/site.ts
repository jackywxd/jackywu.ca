/** 全站常數。siteUrl 抽在這裡，日後若要出大陸鏡像只改一處。 */
export const site = {
  name: '红尘客栈',
  nameLatin: 'Red Dust Inn',
  signature: '追雲逐雪',
  url: 'https://jackywu.ca',
  locale: 'zh-Hant',
  ogLocale: 'zh_TW',
  author: 'Jacky Wu',
  description: '一間江湖客棧。跑步、滑雪、鐵馬、探險，都記在同一條時間軸上。',
} as const;

/** 四行當 —— 一份定義，導覽、篩選、染色、字標全從這裡來 */
export const realms = {
  run:   { label: '奔行', sub: '山野長跑', glyph: '奔', path: '/run/' },
  snow:  { label: '逐雪', sub: '滑雪 · 雪山', glyph: '雪', path: '/snow/' },
  road:  { label: '鐵馬', sub: '摩托 · 長途', glyph: '馳', path: '/road/' },
  wild:  { label: '探幽', sub: '探險 · 遠遊', glyph: '探', path: '/wild/' },
  forge: { label: '爐火', sub: '舊卷 · 技術', glyph: '爐', path: '/forge/' },
  still: { label: '靜',   sub: '',            glyph: '',   path: '' },
} as const;

export type Realm = keyof typeof realms;

/** 主導覽只放六項 */
export const nav = [
  { label: '奔行', href: '/run/' },
  { label: '逐雪', href: '/snow/' },
  { label: '鐵馬', href: '/road/' },
  { label: '探幽', href: '/wild/' },
  { label: '輿圖', href: '/routes/' },
  { label: '掌櫃', href: '/keeper/' },
] as const;
