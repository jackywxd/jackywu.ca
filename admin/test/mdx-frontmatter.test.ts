import { describe, expect, it } from 'vitest';
import { frontmatterToTale } from '../src/lib/mdx-import/frontmatter';

const ok = { title: '標題', date: '2026-03-04', realm: 'run', excerpt: '這是一段足夠長的摘要，通過下限檢查沒有問題。' };

describe('frontmatterToTale', () => {
  it('合格：沒有缺漏、沒有問題', () => {
    const r = frontmatterToTale({ ...ok, slug: 'a-b', tags: ['越野', '跑步'], featured: true });
    expect(r.missing).toEqual([]); expect(r.issues).toEqual([]); expect(r.unknown).toEqual([]);
    expect(r.data).toMatchObject({ title: '標題', slug: 'a-b', date: '2026-03-04', realm: 'run', tags: ['越野', '跑步'], featured: true, shareable: true, lang: 'zh-Hant' });
  });
  it('必填欄位缺什麼就列什麼（不猜、不補預設）', () => {
    expect(frontmatterToTale({ title: 'x' }).missing.sort()).toEqual(['date', 'excerpt', 'realm', 'slug']);
  });
  it('slug 沒寫就用傳進來的備案（例如檔名），並仍然檢查格式', () => {
    expect(frontmatterToTale(ok, 'from-file').data.slug).toBe('from-file');
    expect(frontmatterToTale(ok, '中文檔名').issues.map((i) => i.field)).toContain('slug');
  });
  it('格式問題一次列完，每個指向欄位', () => {
    const r = frontmatterToTale({ title: 'x'.repeat(130), date: '2026-13-01', realm: 'zzz', excerpt: '短', verse: '長'.repeat(50), lang: 'fr' }, 'ok-slug');
    expect(r.issues.map((i) => i.field).sort()).toEqual(['date', 'excerpt', 'lang', 'realm', 'title', 'verse']);
  });
  it('日期只收 YYYY-MM-DD 字串（YAML 解析成 Date 物件的話，呼叫端要在 core schema 解析）', () => {
    expect(frontmatterToTale({ ...ok, date: '2026-3-4' }, 's').issues[0]!.field).toBe('date');
  });
  it('still 一律不產分享海報', () => expect(frontmatterToTale({ ...ok, realm: 'still', shareable: true }, 's').data.shareable).toBe(false));
  it('標籤可以是陣列或逗號字串', () => {
    expect(frontmatterToTale({ ...ok, tags: 'a, b，c、d' }, 's').data.tags).toEqual(['a', 'b', 'c', 'd']);
  });
  it('不認得的欄位列出來，不默默吃掉', () => expect(frontmatterToTale({ ...ok, foo: 1, layout: 'x' }, 's').unknown.sort()).toEqual(['foo', 'layout']));
  it('legacy 保留', () => {
    expect(frontmatterToTale({ ...ok, legacy: { url: '/blog/x/', brokenImages: ['https://a/b.jpg'] } }, 's').data.legacy).toEqual({ url: '/blog/x/', brokenImages: ['https://a/b.jpg'] });
  });
  it('別名：description 當摘要、cover 當封面，並列出換了名字的欄位', () => {
    const { excerpt, ...rest } = ok;
    const r = frontmatterToTale({ ...rest, description: excerpt, cover: './c.jpg' }, 's');
    expect(r.missing).toEqual([]);
    expect(r.data.excerpt).toBe(excerpt);
    expect(r.aliased).toEqual([{ from: 'description', to: 'excerpt' }, { from: 'cover', to: 'hero' }]);
    expect(r.unknown).toEqual([]);
  });
  it('本站的欄位與別名都寫了：以本站的為準，別名列為不認得（不默默蓋掉）', () => {
    const r = frontmatterToTale({ ...ok, description: '另一段描述，比摘要長一點也無所謂。' }, 's');
    expect(r.data.excerpt).toBe(ok.excerpt);
    expect(r.aliased).toEqual([]);
    expect(r.unknown).toEqual(['description']);
  });
  it('空的別名（cover: ""）等於沒寫：不帶入、也不算不認得', () => {
    const r = frontmatterToTale({ ...ok, cover: '' }, 's');
    expect(r.aliased).toEqual([]); expect(r.unknown).toEqual([]);
  });
  it('Claude 寫的 Grouse Grind 稿：摘要從 description 來，只缺行當；作者、分析者、資料來源列為沒帶進來', () => {
    const r = frontmatterToTale({
      title: '十趟 Grouse Grind：一次關於登山杖的自體實驗，以及我如何推翻了自己一半的結論',
      description: '一天之內爬了十趟 Grouse Grind，單數趟徒手、雙數趟帶杖。統計結果乾淨得嚇人，但四個顯著指標全部來自同一個感測器——這篇文章講的是數據，也講的是怎麼不被數據騙。',
      date: '2026-08-17', author: 'Claude', analyst: 'Claude（Anthropic）', dataSource: 'Jacky · COROS + Strava',
      tags: ['訓練', '登山杖', '數據分析', 'TOR450', 'Grouse Grind', '越野跑'], cover: '', draft: true,
    }, 'grouse-grind-pole-experiment');
    expect(r.missing).toEqual(['realm']);
    expect(r.issues).toEqual([]);
    expect(r.aliased).toEqual([{ from: 'description', to: 'excerpt' }]);
    expect(r.unknown.sort()).toEqual(['analyst', 'author', 'dataSource']);
  });
});
