import { test, expect } from '@playwright/test';
import { MANUAL } from './fixtures';

/**
 * 程式碼區塊在兩個主題下都讀得到。
 *
 * 防的是：底色跟著主題走、字色卻寫死成另一個主題的顏色。實際發生過 ——
 * Shiki 只用 github-light，字色是 inline 的 #24292E，而 scroll.css 把底色換成
 * 夜行的 #1d1a16，對比約 1.1:1。用淺色模式的人永遠看不到，
 * 深色模式下爐火那 18 篇技術文整篇讀不了。
 *
 * 要實際渲染、套上 prefers-color-scheme 才觀察得到，所以放在瀏覽器層。
 */

/** WCAG 相對亮度對比 */
const contrastScript = () => {
  const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [l1, l2] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const pres = [...document.querySelectorAll<HTMLElement>('.scroll pre')];
  const bg = getComputedStyle(pres[0]).backgroundColor;
  const body = ratio(getComputedStyle(pres[0]).color, bg);
  let worst = Infinity, worstColor = '';
  for (const pre of pres) {
    const b = getComputedStyle(pre).backgroundColor;
    for (const s of pre.querySelectorAll<HTMLElement>('span')) {
      if (!s.textContent?.trim() || s.children.length) continue;
      const r = ratio(getComputedStyle(s).color, b);
      if (r < worst) { worst = r; worstColor = getComputedStyle(s).color; }
    }
  }
  return { blocks: pres.length, body: +body.toFixed(2), worst: +worst.toFixed(2), worstColor, bg };
};

for (const scheme of ['light', 'dark'] as const) {
  test(`程式碼區塊在${scheme === 'dark' ? '夜行' : '宣紙'}主題下讀得到`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    try {
      await page.goto(MANUAL.path);
      const r = await page.evaluate(contrastScript);
      test.info().annotations.push({ type: 'contrast', description: JSON.stringify(r) });

      expect(r.blocks, '凡例上沒有程式碼區塊可量').toBeGreaterThan(0);
      // 程式碼的本文色：照 WCAG AA 的一般文字標準
      expect(r.body, `程式碼本文對比只有 ${r.body}:1（底 ${r.bg}）—— 字色沒有跟著主題換`).toBeGreaterThanOrEqual(4.5);
      // 任何一個 token 都不能淡到看不見（註解、字串等語法色容許低一點，但有底線）
      expect(r.worst, `最淡的 token ${r.worstColor} 對比只有 ${r.worst}:1（底 ${r.bg}）`).toBeGreaterThanOrEqual(3);
    } finally {
      await ctx.close();
    }
  });
}
