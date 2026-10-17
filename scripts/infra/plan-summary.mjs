#!/usr/bin/env node
/**
 * tofu show -json tfplan | node scripts/infra/plan-summary.mjs [--out=plan-summary.md]
 * 只印「位址＋動作」（邏輯與規則在 packages/infra/plan-summary.ts）。受保護的資源要被刪除或取代時 exit 1。
 * 在 Actions 裡另外寫進步驟摘要（GITHUB_STEP_SUMMARY）與 has_changes 輸出（GITHUB_OUTPUT）。
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { render, summarize } from '../../packages/infra/plan-summary.ts';

const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const s = summarize(JSON.parse(readFileSync(0, 'utf8')));
const text = render(s);
console.log(text);

const md = `<!-- infra-plan -->\n### OpenTofu plan\n\n\`\`\`\n${text}\n\`\`\`\n${s.blocked.length ? `\n**擋下**：以下受保護的資源會被刪除或取代：\n${s.blocked.map((a) => `- \`${a}\``).join('\n')}\n` : ''}`;
if (out) writeFileSync(out, md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${s.lines.length > 0}\n`);

if (s.blocked.length) {
  console.error(`\n✗ 受保護的資源會被刪除或取代：${s.blocked.join('、')}\n  真的要這樣做，請照 docs/infra.md 的「緊急時在本機 apply」處理，不要在 CI 裡做。`);
  process.exit(1);
}
