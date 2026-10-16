#!/usr/bin/env node
/**
 * 依賴一致性：
 *  · 所有 @payloadcms/* 與 payload 必須同一個版本
 *  · lexical / @lexical/* 在整棵依賴樹裡只能有一個版本（自訂編輯器和 Payload 必須共用同一份，
 *    否則節點類別對不上、序列化會壞）
 *  · package.json 的 dependencies 全部釘死（不用 ^ ~）
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dir = process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? '.';
const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
const problems = [];
const all = { ...pkg.dependencies, ...pkg.devDependencies };

const loose = Object.entries(all).filter(([, v]) => /^[\^~><*]|latest|x$/.test(v));
if (loose.length) problems.push(`這些依賴沒有釘死版本：${loose.map(([k, v]) => `${k}@${v}`).join(', ')}`);

const payloadVersions = new Set(Object.entries(all).filter(([k]) => k === 'payload' || k.startsWith('@payloadcms/')).map(([, v]) => v));
if (payloadVersions.size > 1) problems.push(`payload 與 @payloadcms/* 的版本不一致：${[...payloadVersions].join(', ')}`);

const tree = JSON.parse(execFileSync('pnpm', ['ls', '-r', '--depth', 'Infinity', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 }));
const seen = new Map();
const walk = (deps) => {
  for (const [name, d] of Object.entries(deps ?? {})) {
    if (name === 'lexical' || name.startsWith('@lexical/')) {
      if (!seen.has(name)) seen.set(name, new Set());
      seen.get(name).add(d.version);
    }
    walk(d.dependencies);
  }
};
for (const p of tree) walk(p.dependencies);
for (const [name, vs] of seen) if (vs.size > 1) problems.push(`${name} 解析出多個版本：${[...vs].join(', ')}`);
if (!seen.has('lexical')) problems.push('依賴樹裡找不到 lexical（檢查腳本本身壞了？）');

if (problems.length) { console.error(problems.map((p) => `✗ ${p}`).join('\n')); process.exit(1); }
console.log(`✓ 依賴一致：payload ${[...payloadVersions][0]}、lexical ${[...seen.get('lexical')][0]}（單一版本）`);
