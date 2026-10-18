/**
 * 合成的 Payload 語料：涵蓋每一種區塊與每一種內容型別，內容固定、不依賴任何線上資料。
 * 圖片不進 git：由 scripts/fetch-content.mjs 的 fixture 模式用 sharp 依 spec 現場產生（確定性）。
 */
const blk = (fields) => ({ type: 'block', version: 2, fields });
const t = (text, format = 0) => ({ type: 'text', text, format, version: 1 });
const p = (...children) => ({ type: 'paragraph', version: 1, children });
const root = (...children) => ({ root: { type: 'root', version: 1, children } });
const li = (...children) => ({ type: 'listitem', version: 1, children });

export const mediaSpecs = {
  1: { filename: 'cover.jpg', alt: '清晨的山脊線', width: 1600, height: 900, color: '#6b7a8f' },
  2: { filename: 'trail.jpg', alt: '林間小徑', width: 1200, height: 800, color: '#4e6152' },
  3: { filename: 'ridge.jpg', alt: '稜線上的風', width: 1200, height: 800, color: '#8a5a2b' },
  4: { filename: 'poster.jpg', alt: '影片封面', width: 1280, height: 720, color: '#3a4a5a' },
  5: { filename: 'route-cover.jpg', alt: '路線封面', width: 1200, height: 630, color: '#b93a32' },
};

const svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 220" preserveAspectRatio="none"><path id="p" d="${d}"/></svg>`;

export const corpus = {
  media: Object.entries(mediaSpecs).map(([id, m]) => ({ id: Number(id), filename: m.filename, alt: m.alt, width: m.width, height: m.height, kind: 'img' })),
  // 凡例頁（pages/manual.mdx，仍是 git 裡的 MDX）引用這三條路線與 metal-dome 影片，
  // 所以合成語料必須提供同名的條目，否則凡例頁建置不起來
  routes: [{
    id: 2, slug: 'whistler-utmb-100k-2026', name: 'Whistler UTMB', realm: 'run', date: '2026-07-01', region: '卑詩 · 威士拿',
    distanceKm: 100, gainM: 5000, svgTrack: svg('M0 100L1000 120'), svgThumb: svg('M0 100L1000 120'), svgProfile: svg('M0 150L500 40L1000 150'),
  }, {
    id: 3, slug: 'canadian-death-race-2026', name: 'Canadian Death Race', realm: 'run', date: '2026-08-01', region: '亞伯達',
    distanceKm: 118.8, gainM: 4449, svgTrack: svg('M0 100L1000 120'), svgThumb: svg('M0 100L1000 120'), svgProfile: svg('M0 150L500 40L1000 150'),
  }, {
    id: 4, slug: 'castle-tower-loop', name: '城堡塔環線', realm: 'wild', date: '2020-08-15', region: '卑詩',
    distanceKm: 20, gainM: 1200, svgTrack: svg('M0 100L1000 120'), svgThumb: svg('M0 100L1000 120'), svgProfile: svg('M0 150L500 40L1000 150'),
  }, {
    id: 1, slug: 'fixture-ridge', name: '稜線測試路線', nameEn: 'Fixture Ridge', realm: 'run', date: '2026-06-01', region: '卑詩 · 測試',
    distanceKm: 50, gainM: 1800, elapsed: 'PT6H40M', movingTime: 'PT6H15M', startedAt: '2026-06-01T05:30-07:00', badge: 'TEST · 50K · 2026', cover: 5, coverAlt: '路線封面',
    svgTrack: svg('M0 100L1000 125'), svgThumb: svg('M0 100L1000 125'), svgProfile: svg('M0 160L500 30L1000 160'), // 獨有的路徑：git 裡沒有，分得出讀的是哪個資料夾
  }],
  reels: [{
    id: 1, title: '測試影片', videoId: 'metal-dome', poster: 4, posterAlt: '影片封面', duration: 30, bytes: 1048576,
    ratio: '16/9', realm: 'snow', date: '2026-02-08', caption: '雪線之上。',
  }],
  tales: [
    {
      id: 1, title: '稜線上的一天', slug: 'ridge-day', date: '2026-06-02', realm: 'run', lang: 'zh-Hant',
      tags: ['越野', '測試'], featured: true, shareable: true,
      excerpt: '從清晨出發，沿著稜線跑了五十公里，風很大，人很少，回來什麼都記得。',
      verse: '稜線之上，只剩風。', hero: 1, heroAlt: '清晨的山脊線', route: 1, video: 1,
      content: root(
        { type: 'heading', tag: 'h2', version: 1, children: [t('出發')] },
        p(t('天還沒亮就出門。'), t('這句是粗體', 1), t('，這句是斜體', 2), t('，然後看', 0),
          { type: 'link', version: 3, fields: { linkType: 'custom', url: 'https://example.com/a?b=1&c=2', newTab: true }, children: [t('這個連結')] }, t('。')),
        { type: 'quote', version: 1, children: [t('路是走出來的。')] },
        { type: 'list', listType: 'bullet', version: 1, children: [li(t('水')), li(t('鹽')), li({ type: 'list', listType: 'number', version: 1, children: [li(t('巢狀的一項'))] })] },
        { type: 'table', version: 1, children: [
          { type: 'tablerow', version: 1, children: [{ type: 'tablecell', headerState: 1, version: 1, children: [p(t('公里'))] }, { type: 'tablecell', headerState: 1, version: 1, children: [p(t('配速'))] }] },
          { type: 'tablerow', version: 1, children: [{ type: 'tablecell', headerState: 0, version: 1, children: [p(t('10'))] }, { type: 'tablecell', headerState: 0, version: 1, children: [p(t('6:10'))] }] },
        ] },
        blk({ blockType: 'figure', media: 2, caption: '林間', wide: true }),
        blk({ blockType: 'gallery', items: [{ media: 2 }, { media: 3, alt: '稜線' }], caption: '兩張' }),
        blk({ blockType: 'route', route: 1, show: 'both', from: 10, to: 20, label: '爬升段', caption: '路線' }),
        blk({ blockType: 'video', reel: 1, caption: '雪線' }),
        blk({ blockType: 'missingImage', original: 'https://example.com/gone.jpg', hint: '舊站圖片' }),
        { type: 'horizontalrule', version: 1 },
        p(t('結束。')),
      ),
    },
    {
      id: 2, title: '爐火筆記', slug: 'forge-note', date: '2025-11-20', realm: 'forge', lang: 'zh-Hant', tags: ['技術'],
      shareable: true, excerpt: '一則關於如何在小機器上跑起服務的筆記，順便記下踩過的坑與解法。',
      content: root(p(t('第一段。')), { type: 'heading', tag: 'h3', version: 1, children: [t('細節')] }, p(t('第二段。'))),
    },
    {
      id: 3, title: '靜', slug: 'still-one', date: '2026-01-05', realm: 'still', shareable: false, tags: [],
      excerpt: '私人的一篇，不產分享海報，也不進時光機，只留一個網址給自己。',
      content: root(p(t('只給自己。'))),
    },
    {
      // 路線圖當封面：沒有 hero 圖片，封面是 fixture-ridge 的軌跡
      id: 4, title: '路線當封面', slug: 'route-cover', date: '2026-06-03', realm: 'run', lang: 'zh-Hant', tags: ['測試'], shareable: true,
      excerpt: '一篇用路線圖當封面的文章，沒有封面照片，頁首直接畫出那條路線的輪廓。',
      heroRoute: true, heroAlt: '路線圖：稜線測試路線，50 km', route: 1,
      content: root(p(t('封面是路線圖。'))),
    },
  ],
  pages: [],
  redirects: [{ from: '/blog/old-post/', to: '/tales/2026/ridge-day/' }, { from: '/tales/ridge', to: '/tales/2026/ridge-day/' }],
};
