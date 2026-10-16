import { describe, expect, it } from 'vitest';
import { fitWithin, sha256Hex } from '../src/lib/media-client';

describe('fitWithin', () => {
  it('長邊在上限內 → 不縮', () => expect(fitWithin(2560, 1000)).toEqual({ width: 2560, height: 1000, scaled: false }));
  it('橫圖：長邊縮到 2560，比例保持', () => expect(fitWithin(5120, 2880)).toEqual({ width: 2560, height: 1440, scaled: true }));
  it('直圖（手機直拍）：高是長邊', () => expect(fitWithin(3024, 4032)).toEqual({ width: 1920, height: 2560, scaled: true }));
  it('極端比例不會縮成 0', () => expect(fitWithin(100_000, 3)).toEqual({ width: 2560, height: 1, scaled: true }));
  it.each([[0, 10], [10, 0], [-1, 5], [NaN, 5]])('不合理的尺寸 %j → 丟錯', (w, h) => expect(() => fitWithin(w, h)).toThrow());
  it('可以指定上限', () => expect(fitWithin(2000, 1000, 1000)).toEqual({ width: 1000, height: 500, scaled: true }));
});

describe('sha256Hex', () => {
  it('已知向量', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
