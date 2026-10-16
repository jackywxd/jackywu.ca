import { describe, expect, it } from 'vitest';
import { scan } from '../scripts/token-rules.mjs';

const rules = (s: string) => (scan(s) as { rule: string }[]).map((x) => x.rule);

describe('token 規則', () => {
  it.each(['color: #fff;', 'background: #1a2b3c;', 'border-color: #12345678;', 'x: rgb(1,2,3)', 'x: rgba(0 0 0 / .5)', 'x: oklch(0.5 0.1 20)'])('擋下 %s', (s) => expect(rules(s).length).toBeGreaterThan(0));
  it.each(['padding: 4px;', 'margin: 16px', 'gap: 12.5px', 'inline-size: 320px'])('擋下寫死的 px：%s', (s) => expect(rules(s)).toContain('寫死的 px 長度（>3px）'));
  it.each(['border: 1px solid var(--edge);', 'outline: 2px solid var(--accent)', 'outline-offset: 3px', 'padding: var(--space-2)', 'min-height: var(--touch)', 'x: 0px', 'font-size: 1rem', 'margin: 0'])('放行 %s', (s) => expect(rules(s)).toEqual([]));
  it('HTML 實體（&#39;）與 URL 裡的 # 不是色碼', () => {
    expect(rules("text.replace(/'/g, '&#39;')")).toEqual([]);
    expect(rules('href="https://a.com/#top"')).toEqual([]);
    expect(rules("id='#main'")).toEqual([]); // #main 不是 3/4/6/8 位十六進位
  });
  it('註解裡寫的不算', () => {
    expect(rules('/* 舊的是 #fff 與 16px */')).toEqual([]);
    expect(rules('// 之前用 #123456')).toEqual([]);
    expect(rules('/*\n 多行註解 #abc 12px\n*/\ncolor: var(--fg);')).toEqual([]);
  });
  it('註解結束後同一行的違規還是會被抓到', () => {
    expect(rules('/* x */ color: #fff;')).toContain('寫死的色碼');
  });
});
