import { describe, expect, it } from 'vitest';
import type { Field } from 'payload';
import { Tales } from '../src/collections/Tales';
import { CONTROLLED_ELSEWHERE, missingControls, TALE_FORM_FIELDS } from '../src/editor/tale-form';

const named = (Tales.fields as Field[]).filter((f): f is Field & { name: string } => 'name' in f && typeof f.name === 'string');

describe('文章表單 ↔ Payload 集合（靜態對照）', () => {
  const formNames = new Set(TALE_FORM_FIELDS.map((f) => f.name));

  it('每個必填欄位都有對應的控制項（沒有的話使用者被要求填一個畫面上找不到的東西）', () => {
    const required = named.filter((f) => (f as { required?: boolean }).required).map((f) => f.name);
    expect(required.length).toBeGreaterThan(0); // 探針自己要能報出「有東西」
    expect(missingControls(required), '必填欄位沒有控制項').toEqual([]);
    void formNames;
  });
  it('表單清單裡的每個名字，集合裡都還存在（對照表沒有過期）', () => {
    const all = new Set(named.map((f) => f.name));
    for (const f of TALE_FORM_FIELDS) expect(all.has(f.name), `表單欄位「${f.name}」在 tales 集合裡不存在`).toBe(true);
    for (const name of Object.keys(CONTROLLED_ELSEWHERE)) expect(all.has(name), `「${name}」在 tales 集合裡不存在`).toBe(true);
  });
  it('表單欄位名稱沒有重複', () => expect(new Set(TALE_FORM_FIELDS.map((f) => f.name)).size).toBe(TALE_FORM_FIELDS.length));
  it('反向驗證：拿掉一個必填欄位的控制項，同一個檢查函式會抓到（不是在測試裡另寫一份）', () => {
    const required = named.filter((f) => (f as { required?: boolean }).required).map((f) => f.name);
    expect(missingControls(required, TALE_FORM_FIELDS.filter((f) => f.name !== 'slug'))).toEqual(['slug']);
  });
});
