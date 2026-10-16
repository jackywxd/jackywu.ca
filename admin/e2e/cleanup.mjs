// 在 Playwright 結束後獨立運作的清理：等本機後台關掉（連接埠不再有人聽），再刪掉暫存目錄。
// 不能放在 globalTeardown：Playwright 是「先跑 globalTeardown、再關 webServer」，
// 而 workerd 關閉時會把空的子目錄建回來。
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';

const [dir, portStr] = process.argv.slice(2);
if (!dir || !dir.includes('hongchen-admin-e2e-') || !portStr) process.exit(2); // 只刪我們自己建的那種目錄
const port = Number(portStr);

const listening = () => new Promise((res) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

for (let i = 0; i < 120 && (await listening()); i++) await new Promise((r) => setTimeout(r, 500)); // 最多等 60 秒
for (let i = 0; i < 40; i++) {                                                                       // 關閉後的 6 秒內，建回來就再刪
  rmSync(dir, { recursive: true, force: true });
  await new Promise((r) => setTimeout(r, 150));
  if (!existsSync(dir) && i > 20) break;
}
rmSync(dir, { recursive: true, force: true });
