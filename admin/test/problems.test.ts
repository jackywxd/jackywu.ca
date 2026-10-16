import { describe, expect, it } from 'vitest';
import { clean } from '../src/editor/BlockSheet';
import { blockProblems, isBlank } from '../src/editor/problems';

const st = (...children: unknown[]) => ({ root: { type: 'root', children } }) as never;
const blk = (fields: Record<string, unknown>) => ({ type: 'block', fields });

describe('blockProblems', () => {
  it('列出每個缺東西的區塊，並以「第幾個區塊」編號', () => {
    const r = blockProblems(st({ type: 'paragraph', children: [] }, blk({ blockType: 'figure' }), blk({ blockType: 'figure', media: 1 }), blk({ blockType: 'gallery', items: [] }), blk({ blockType: 'rawMdx', source: 'x' })));
    expect(r).toEqual([
      { index: 1, blockType: 'figure', message: '還沒選圖' },
      { index: 3, blockType: 'gallery', message: '圖組是空的' },
      { index: 4, blockType: 'rawMdx', message: '這段內容無法在網站上顯示' },
    ]);
  });
  it('video／route 沒選也算', () => {
    expect(blockProblems(st(blk({ blockType: 'video' }), blk({ blockType: 'route' }))).map((p) => p.message)).toEqual(['還沒選影片', '還沒選路線']);
  });
  it('沒有問題 → 空', () => expect(blockProblems(st(blk({ blockType: 'inkRule' }), blk({ blockType: 'code', code: 'x' })))).toEqual([]));
  it('null 與空文件不會丟錯', () => { expect(blockProblems(null)).toEqual([]); expect(blockProblems(st())).toEqual([]); });
});

describe('isBlank', () => {
  it('沒標題也沒字也沒區塊 → 空白稿', () => expect(isBlank('', st({ type: 'paragraph', children: [] }))).toBe(true));
  it('有標題就不是', () => expect(isBlank('標', null)).toBe(false));
  it('有文字就不是', () => expect(isBlank('', st({ type: 'paragraph', children: [{ type: 'text', text: '字' }] }))).toBe(false));
  it('只有一個區塊也不是', () => expect(isBlank('', st(blk({ blockType: 'inkRule' })))).toBe(false));
});

describe('clean（區塊欄位存檔前整理）', () => {
  it('空字串、false、undefined 都不寫進去', () => {
    expect(clean({ blockType: 'figure', media: 3, caption: '', wide: false, href: undefined })).toEqual({ blockType: 'figure', media: 3 });
  });
  it('true 保留；0 保留（路線的 from 可以是 0）', () => {
    expect(clean({ blockType: 'route', route: 2, from: 0, wide: true })).toEqual({ blockType: 'route', route: 2, from: 0, wide: true });
  });
  it('待補圖的 original 與程式碼的 language／code 即使是空字串也保留（必填）', () => {
    expect(clean({ blockType: 'missingImage', original: '' })).toEqual({ blockType: 'missingImage', original: '' });
    expect(clean({ blockType: 'code', language: '', code: '' })).toEqual({ blockType: 'code', language: '', code: '' });
  });
});
