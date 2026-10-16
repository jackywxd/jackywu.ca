import { spawn } from 'node:child_process';
import path from 'node:path';

/** 交給獨立的清理行程：等後台真的關掉之後才刪暫存目錄（見 e2e/cleanup.mjs） */
export default async function teardown() {
  const dir = process.env.E2E_DIR;
  if (!dir || !dir.includes('hongchen-admin-e2e-')) return;
  spawn(process.execPath, [path.join(import.meta.dirname, 'cleanup.mjs'), dir, '8788'], { detached: true, stdio: 'ignore' }).unref();
}
