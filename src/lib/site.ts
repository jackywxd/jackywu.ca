/** 全站常數。siteUrl 抽在這裡，日後若要出大陸鏡像只改一處。 */
export const site = {
  name: '紅塵客棧',
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
  run:   { label: '追雲', sub: '山野長跑', glyph: '雲', path: '/run/' },
  snow:  { label: '逐雪', sub: '滑雪 · 雪山', glyph: '雪', path: '/snow/' },
  road:  { label: '鐵馬', sub: '摩托 · 長途', glyph: '馳', path: '/road/' },
  wild:  { label: '探幽', sub: '探險 · 遠遊', glyph: '探', path: '/wild/' },
  forge: { label: '爐火', sub: '舊卷 · 技術', glyph: '爐', path: '/forge/' },
  still: { label: '靜',   sub: '',            glyph: '',   path: '' },
} as const;

export type Realm = keyof typeof realms;

/**
 * 主導覽，分三組。
 *
 * 分組本身就是資訊：行當是站的主體、翻閱是找東西的方式、客棧是關於這間店。
 * 桌機上三組連成一行、看不出分界（跟原本一模一樣）；手機上收進選單，
 * 分組才現形 —— 九個平鋪的連結在 375px 會折成兩行、吃掉第一屏四成。
 */
export const navGroups = [
  {
    label: '行當',
    items: [
      { label: '追雲', href: '/run/' },
      { label: '逐雪', href: '/snow/' },
      { label: '鐵馬', href: '/road/' },
      { label: '探幽', href: '/wild/' },
    ],
  },
  {
    label: '翻閱',
    items: [
      { label: '輿圖', href: '/routes/' },
      { label: '江湖冊', href: '/tags/' },
      { label: '尋', href: '/search/' },
    ],
  },
  {
    label: '客棧',
    items: [
      { label: '掌櫃', href: '/keeper/' },
      { label: '凡例', href: '/manual/' },
    ],
  },
] as const;

export interface NavItem { readonly label: string; readonly href: string }

/**
 * 扁平版，給只需要一串連結的地方用。
 * 回傳型別要明寫：as const 讓三組各是不同的唯讀元組，flatMap 推不出共同型別
 * （astro check 的 ts2322，CI 抓到的）。
 */
export const nav: readonly NavItem[] = navGroups.flatMap((g): readonly NavItem[] => g.items);
