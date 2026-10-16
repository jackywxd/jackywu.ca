import { describe, expect, it } from 'vitest';
import { collectMedia, lexicalToTree, safeHref, UnknownNodeError } from './lexical';

const root = (...children: unknown[]) => ({ root: { type: 'root', children } });
const p = (...children: unknown[]) => ({ type: 'paragraph', children });
const t = (text: string, format = 0) => ({ type: 'text', text, format });
const blk = (fields: Record<string, unknown>) => ({ type: 'block', fields });
const tree = (...c: unknown[]) => lexicalToTree(root(...c), 'x');

describe('文字與格式', () => {
  it('段落與格式位元', () => {
    expect(tree(p(t('a', 1 | 2), t('b', 16 | 4)))).toEqual([
      { t: 'p', children: [{ t: 'text', text: 'a', bold: true, italic: true }, { t: 'text', text: 'b', code: true, strike: true }] },
    ]);
  });
  it('換行', () => expect(tree(p(t('a'), { type: 'linebreak' }, t('b')))[0]).toMatchObject({ children: [{}, { t: 'br' }, {}] }));
  it('H2–H4 通過，H1 與 H5 拒絕並說明原因', () => {
    expect(tree({ type: 'heading', tag: 'h3', children: [t('x')] })[0]).toMatchObject({ t: 'h', level: 3 });
    for (const tag of ['h1', 'h5', 'h6']) {
      expect(() => tree({ type: 'heading', tag, children: [] })).toThrow(/只允許 H2–H4/);
    }
  });
  it('引言、分隔線', () => {
    expect(tree({ type: 'quote', children: [t('q')] }, { type: 'horizontalrule' }).map((b) => b.t)).toEqual(['quote', 'hr']);
  });
});

describe('連結的安全', () => {
  it.each(['https://a.com/x', 'http://a.com', 'mailto:a@b.com', '/tales/2026/x/', '#top'])('接受 %s', (u) =>
    expect(safeHref(u, 'x')).toBe(u));
  it.each(['javascript:alert(1)', 'JaVaScRiPt:1', 'data:text/html,x', '//evil.com', 'vbscript:x', '', 'ftp://x'])('拒絕 %j', (u) =>
    expect(() => safeHref(u, 'x')).toThrow(UnknownNodeError));
  it('連結節點帶 newTab', () => {
    const n = tree(p({ type: 'link', fields: { linkType: 'custom', url: 'https://a.com', newTab: true }, children: [t('go')] }));
    expect(n[0]).toMatchObject({ children: [{ t: 'link', href: 'https://a.com', newTab: true }] });
  });
  it('Lexical 原生 LinkNode 的 JSON（url／target）也看得懂，且一樣過安全檢查', () => {
    expect(tree(p({ type: 'link', url: 'https://a.com', target: '_blank', children: [t('go')] }))[0]).toMatchObject({ children: [{ t: 'link', href: 'https://a.com', newTab: true }] });
    expect(() => tree(p({ type: 'link', url: 'javascript:alert(1)', children: [] }))).toThrow(/不是 http/);
  });
  it('內部連結（尚未支援）要大聲拒絕，不是輸出壞連結', () => {
    expect(() => tree(p({ type: 'link', fields: { linkType: 'internal', doc: 1 }, children: [] }))).toThrow(/內部連結/);
  });
});

describe('清單', () => {
  const li = (...c: unknown[]) => ({ type: 'listitem', children: c });
  it('有序與無序', () => {
    expect(tree({ type: 'list', listType: 'number', children: [li(t('a'))] })[0]).toMatchObject({ t: 'list', ordered: true });
    expect(tree({ type: 'list', listType: 'bullet', children: [li(t('a'))] })[0]).toMatchObject({ ordered: false });
  });
  it('巢狀清單併到前一項底下', () => {
    const b = tree({
      type: 'list', listType: 'bullet',
      children: [li(t('a')), li({ type: 'list', listType: 'bullet', children: [li(t('a1'))] })],
    })[0] as Extract<ReturnType<typeof tree>[number], { t: 'list' }>;
    expect(b.items).toHaveLength(1);
    expect(b.items[0]!.sub?.items[0]?.children[0]).toMatchObject({ text: 'a1' });
  });
  it('核取清單拒絕', () => expect(() => tree({ type: 'list', listType: 'check', children: [] })).toThrow(/核取清單/));
});

describe('表格', () => {
  it('表頭列與內容列', () => {
    const cell = (h: number, s: string) => ({ type: 'tablecell', headerState: h, children: [p(t(s))] });
    const b = tree({ type: 'table', children: [
      { type: 'tablerow', children: [cell(1, 'h1'), cell(1, 'h2')] },
      { type: 'tablerow', children: [cell(0, 'a'), cell(0, 'b')] },
    ] })[0];
    expect(b).toMatchObject({ t: 'table', rows: [{ header: true }, { header: false }] });
  });
});

describe('區塊', () => {
  it('figure：媒體 id 可以是數字、字串或已展開的物件', () => {
    for (const media of [7, '7', { id: 7 }]) {
      expect(tree(blk({ blockType: 'figure', media, caption: 'c' }))[0]).toEqual({ t: 'figure', media: '7', caption: 'c', wide: false });
    }
  });
  it('figure 帶連結（YouTube 縮圖這類）：網址同樣要過安全檢查', () => {
    expect(tree(blk({ blockType: 'figure', media: 1, href: 'https://youtu.be/x' }))[0]).toMatchObject({ href: 'https://youtu.be/x' });
    expect(() => tree(blk({ blockType: 'figure', media: 1, href: 'javascript:alert(1)' }))).toThrow(/不是 http/);
  });
  it('figure 沒選圖 → 拒絕', () => expect(() => tree(blk({ blockType: 'figure' }))).toThrow(/沒有選圖片/));
  it('gallery / video / route / missingImage / inkRule', () => {
    expect(tree(blk({ blockType: 'gallery', items: [{ media: 1, alt: 'a' }, { media: 2, alt: 'b' }] }))[0]).toMatchObject({ t: 'gallery' });
    expect(() => tree(blk({ blockType: 'gallery', items: [] }))).toThrow(/圖組/);
    expect(() => tree(blk({ blockType: 'gallery', items: [{ alt: 'x' }] }))).toThrow(/圖組/);
    expect(tree(blk({ blockType: 'video', reel: 3 }))[0]).toEqual({ t: 'video', reel: '3', caption: undefined });
    expect(() => tree(blk({ blockType: 'video' }))).toThrow(/沒有選影片/);
    expect(tree(blk({ blockType: 'route', route: 9, show: 'both', from: 40, to: 55 }))[0]).toMatchObject({ t: 'route', route: '9', show: 'both', from: 40, to: 55 });
    expect(() => tree(blk({ blockType: 'route', route: 9, show: 'weird' }))).toThrow(/show=weird/);
    expect(tree(blk({ blockType: 'missingImage', original: 'https://x/y.jpg' }))[0]).toMatchObject({ t: 'missing' });
    expect(tree(blk({ blockType: 'inkRule' }))[0]).toEqual({ t: 'ink' });
    expect(tree(blk({ blockType: 'code', language: 'bash', code: 'echo "hi"' }))[0]).toEqual({ t: 'code', language: 'bash', code: 'echo "hi"' });
    expect(() => tree(blk({ blockType: 'code', language: 'bash' }))).toThrow(/沒有內容/);
    // 轉不了的 JSX 以 rawMdx 保留，但絕不能被渲染出去
    expect(() => tree(blk({ blockType: 'rawMdx', source: '<figure/>' }))).toThrow(/rawMdx/);
  });
});

describe('認不得的節點一律大聲失敗', () => {
  it.each([
    ['未知的頂層節點', { type: 'mystery', children: [] }],
    ['未知的 block', blk({ blockType: 'rawMdx' })],
    ['段落裡的未知 inline', p({ type: 'mention' })],
  ])('%s', (_n, node) => {
    const err = (() => { try { tree(node); } catch (e) { return e as UnknownNodeError; } })();
    expect(err).toBeInstanceOf(UnknownNodeError);
    expect(err!.message).toContain('文章 x'); // 錯誤要帶 slug
  });
  it('不是 Lexical 狀態', () => {
    expect(() => lexicalToTree(null, 's')).toThrow(UnknownNodeError);
    expect(() => lexicalToTree({ root: { type: 'nope' } }, 's')).toThrow(UnknownNodeError);
  });
});

describe('collectMedia', () => {
  it('去重並涵蓋 figure 與 gallery', () => {
    const b = tree(
      blk({ blockType: 'figure', media: 1 }),
      blk({ blockType: 'gallery', items: [{ media: 1, alt: '' }, { media: 2, alt: '' }] }),
    );
    expect(collectMedia(b).sort()).toEqual(['1', '2']);
  });
});
