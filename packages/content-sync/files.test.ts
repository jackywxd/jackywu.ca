import { describe, expect, it } from 'vitest';
import { buildFiles, type Corpus, type TaleDoc } from './files';

const blk = (fields: Record<string, unknown>) => ({ type: 'block', fields });
const body = (...c: unknown[]) => ({ root: { type: 'root', children: c } });
const tale = (o: Partial<TaleDoc> = {}): TaleDoc => ({
  id: 1, title: '標題', slug: 'a', date: '2026-03-04', realm: 'run', excerpt: '摘要摘要摘要摘要摘要摘要摘要', ...o,
});
const corpus = (o: Partial<Corpus> = {}): Corpus => ({ tales: [], pages: [], routes: [], reels: [], media: [], redirects: [], ...o });
const text = (r: ReturnType<typeof buildFiles>, p: string) => JSON.parse((r.files.get(p) as { text: string }).text);

describe('buildFiles：文章', () => {
  it('路徑用 date 的年份切字串，不經 Date', () => {
    const r = buildFiles(corpus({ tales: [tale({ date: '2026-12-31' }), tale({ id: 2, slug: 'b', date: '2025-01-01' })] }));
    expect([...r.files.keys()]).toContain('tales/2026/a/index.json');
    expect([...r.files.keys()]).toContain('tales/2025/b/index.json');
  });
  it('同年同 slug → 報錯，不是靜默覆蓋', () => {
    expect(() => buildFiles(corpus({ tales: [tale(), tale({ id: 2 })] }))).toThrow(/重複/);
  });
  it('正文的圖：複製到 media/，並寫進 media 對照表', () => {
    const r = buildFiles(corpus({
      tales: [tale({ content: body(blk({ blockType: 'figure', media: 5, caption: 'c' })) })],
      media: [{ id: 5, filename: 'IMG.JPG', alt: '雪' }],
    }));
    expect(r.files.get('tales/2026/a/media/5.jpg')).toEqual({ media: '5' });
    expect(text(r, 'tales/2026/a/index.json').media).toEqual({ '5': './media/5.jpg' });
    expect(text(r, 'tales/2026/a/index.json').body[0]).toMatchObject({ t: 'figure', alt: '雪' });
  });
  it('圖組的格子沒寫 alt 就繼承媒體庫的', () => {
    const r = buildFiles(corpus({
      tales: [tale({ content: body(blk({ blockType: 'gallery', items: [{ media: 5 }, { media: 6, alt: '自訂' }] })) })],
      media: [{ id: 5, filename: 'a.jpg', alt: '預設' }, { id: 6, filename: 'b.jpg', alt: '另一個' }],
    }));
    expect(text(r, 'tales/2026/a/index.json').body[0].items.map((i: { alt: string }) => i.alt)).toEqual(['預設', '自訂']);
  });
  it('hero 放在文章資料夾，路徑相對於 json', () => {
    const r = buildFiles(corpus({
      tales: [tale({ hero: { id: 9 }, heroAlt: '封面' })], media: [{ id: 9, filename: 'x.webp' }],
    }));
    expect(text(r, 'tales/2026/a/index.json').hero).toBe('./9.webp');
  });
  it('引用了沒有一起發佈的媒體 → 明確報錯並指出依賴', () => {
    expect(() => buildFiles(corpus({ tales: [tale({ content: body(blk({ blockType: 'figure', media: 5 })) })] }))).toThrow(/依賴沒有一起發佈/);
  });
  it('引用了沒發佈的路線／影片 → 報錯', () => {
    expect(() => buildFiles(corpus({ tales: [tale({ route: 3 })] }))).toThrow(/路線 3/);
    expect(() => buildFiles(corpus({ tales: [tale({ video: 4 })] }))).toThrow(/影片 4/);
    expect(() => buildFiles(corpus({ tales: [tale({ content: body(blk({ blockType: 'route', route: 3 })) })] }))).toThrow(/路線區塊/);
  });
  it('正文的 video／route 區塊換成內容 id（前台元件吃的是內容 id）', () => {
    const r = buildFiles(corpus({
      tales: [tale({ content: body(blk({ blockType: 'video', reel: 1 }), blk({ blockType: 'route', route: 2 })) })],
      reels: [{ id: 1, title: 'v', videoId: 'metal-dome', poster: 7, posterAlt: 'p', duration: 10, bytes: 99, realm: 'snow', date: '2026-02-01' }],
      routes: [{ id: 2, slug: 'whistler', name: 'W', realm: 'run', date: '2026-07-01', region: 'BC' }],
      media: [{ id: 7, filename: 'p.jpg' }],
    }));
    const b = text(r, 'tales/2026/a/index.json').body;
    expect(b[0]).toMatchObject({ t: 'video', reel: '2026/metal-dome' });
    expect(b[1]).toMatchObject({ t: 'route', route: '2026/whistler' });
  });
  it('認不得的節點 → 建置失敗並帶 slug', () => {
    expect(() => buildFiles(corpus({ tales: [tale({ content: body({ type: 'mystery' }) })] }))).toThrow(/2026\/a/);
  });
  it('沒有 content 的文章是合法的（空正文）', () => {
    expect(text(buildFiles(corpus({ tales: [tale()] })), 'tales/2026/a/index.json').body).toEqual([]);
  });
});

describe('buildFiles：影片、路線、轉址', () => {
  const reel = { id: 1, title: 'v', videoId: 'metal-dome', poster: 7, posterAlt: 'p', duration: 10, bytes: 99, realm: 'snow', date: '2026-02-01' };
  it('影片：promote 的 key 與 poster 檔', () => {
    const r = buildFiles(corpus({ reels: [reel], media: [{ id: 7, filename: 'p.jpg' }] }));
    expect(r.promoteKeys).toEqual(['video/metal-dome/1080p.mp4', 'video/metal-dome/poster.jpg']);
    expect(r.files.get('reel/2026/7.jpg')).toEqual({ media: '7' });
    expect(text(r, 'reel/2026/metal-dome.json')).toMatchObject({ id: 'metal-dome', poster: './7.jpg' });
  });
  it('影片還沒轉碼完（沒有 duration/bytes）→ 不能發佈', () => {
    expect(() => buildFiles(corpus({ reels: [{ ...reel, duration: null }], media: [{ id: 7, filename: 'p.jpg' }] }))).toThrow(/還沒轉碼完成/);
  });
  it('路線：三張 svg 寫成檔案，hasGpx 才 promote', () => {
    const r = buildFiles(corpus({
      routes: [{ id: 2, slug: 'w', name: 'W', realm: 'run', date: '2026-07-01', region: 'BC', svgTrack: '<svg/>', svgThumb: '<svg t/>', svgProfile: '<svg p/>', hasGpx: true }],
    }));
    expect((r.files.get('routes/2026/w.profile.svg') as { text: string }).text).toBe('<svg p/>');
    expect(r.promoteKeys).toEqual(['gpx/w.gpx']);
    expect(JSON.parse((r.files.get('routes/2026/w.json') as { text: string }).text).gpx).toBe('w.gpx');
  });
  it('downloadable: false 的路線：GPX 原檔不公開（完整軌跡含時間與起點，先前一律被搬到公開 bucket）', () => {
    const r = buildFiles(corpus({ routes: [{ id: 2, slug: 'p', name: 'P', realm: 'run', date: '2026-07-01', region: 'BC', hasGpx: true, downloadable: false }] }));
    expect(r.promoteKeys).toEqual([]);
    expect(JSON.parse((r.files.get('routes/2026/p.json') as { text: string }).text)).not.toHaveProperty('gpx');
  });
  it.each([
    ['<svg><script>alert(1)</script></svg>', 'script'],
    ['<svg onload="alert(1)"><path d="M0 0"/></svg>', '事件屬性'],
    ['<svg><a href="https://evil"><path d="M0 0"/></a></svg>', '連結'],
    ['<svg><foreignObject><div/></foreignObject></svg>', 'foreignObject'],
    ['<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', '實體'],
  ])('路線 SVG 會被直接嵌進頁面：%j 一律拒絕（%s）', (svg) => {
    expect(() => buildFiles(corpus({ routes: [{ id: 2, slug: 'x', name: 'X', realm: 'run', date: '2026-07-01', region: 'BC', svgTrack: svg }] }))).toThrow(/SVG/);
  });
  it('程式產生的 SVG（路徑、文字、樣式屬性）照常通過', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400"><path d="M0 0L10 10" stroke="currentColor" fill="none" vector-effect="non-scaling-stroke"/><text x="5" y="5">1,234 m</text></svg>';
    expect(() => buildFiles(corpus({ routes: [{ id: 2, slug: 'ok', name: 'OK', realm: 'run', date: '2026-07-01', region: 'BC', svgTrack: svg, svgThumb: svg, svgProfile: svg }] }))).not.toThrow();
  });
  it('沒有 GPX 的路線：不 promote、frontmatter 沒有 gpx', () => {
    const r = buildFiles(corpus({ routes: [{ id: 2, slug: 'n', name: 'N', realm: 'run', date: '2026-07-01', region: 'BC' }] }));
    expect(r.promoteKeys).toEqual([]);
    expect(JSON.parse((r.files.get('routes/2026/n.json') as { text: string }).text)).not.toHaveProperty('gpx');
  });
  it('轉址含空白 → 報錯', () => {
    expect(() => buildFiles(corpus({ redirects: [{ from: '/a b/', to: '/c/' }] }))).toThrow(/空白/);
  });
  it('轉址依來源排序，輸出穩定', () => {
    const r = buildFiles(corpus({ redirects: [{ from: '/b/', to: '/x/' }, { from: '/a/', to: '/x/' }] }));
    expect(text(r, 'redirects.json').map((x: { from: string }) => x.from)).toEqual(['/a/', '/b/']);
  });
  it('輸出是確定的：同樣的輸入產生同樣的檔案', () => {
    const c = corpus({ tales: [tale()], redirects: [{ from: '/a/', to: '/b/' }] });
    const a = [...buildFiles(c).files.entries()], b = [...buildFiles(c).files.entries()];
    expect(a).toEqual(b);
  });
});
