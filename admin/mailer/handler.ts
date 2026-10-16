import { buildMime } from '../src/lib/notify';

/**
 * 寄信 Worker 的處理邏輯（與 cloudflare:email 解耦，測試才能跑）。
 * 只有一個動作：用設定好的寄件人，寄給設定好的收件人。後台只能指定主旨與內文，
 * 所以後台就算被入侵，也不能拿它寄信給別人。
 */
export interface MailerEnv { NOTIFY_FROM: string; NOTIFY_TO: string }
export type Send = (from: string, to: string, raw: string) => Promise<void>;

export async function handleSend(req: Request, env: MailerEnv, send: Send, now = new Date()): Promise<Response> {
  if (req.method !== 'POST' || new URL(req.url).pathname !== '/send') return new Response('not found', { status: 404 });
  if (!env.NOTIFY_FROM || !env.NOTIFY_TO) return new Response('mailer 沒有設定寄件人或收件人', { status: 500 });
  let b: { subject?: unknown; text?: unknown };
  try { b = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  if (typeof b.subject !== 'string' || typeof b.text !== 'string' || !b.subject.trim() || b.subject.length > 200 || b.text.length > 20_000) return new Response('bad fields', { status: 400 });
  try {
    await send(env.NOTIFY_FROM, env.NOTIFY_TO, buildMime({ from: env.NOTIFY_FROM, to: env.NOTIFY_TO, subject: b.subject, text: b.text, messageId: `${now.getTime().toString(36)}.${crypto.randomUUID()}@jackywu.ca`, date: now }));
  } catch (e) { return new Response(`寄信失敗：${(e as Error).message}`, { status: 502 }); }
  return new Response('sent', { status: 202 });
}
