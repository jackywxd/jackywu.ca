/**
 * Worker 綁定（D1、R2、轉碼服務）的取得點。
 * payload.config.ts 在載入時把它拿到的 env 放進來；端點與服務層從這裡讀，
 * 不必各自去找 Cloudflare context（測試也只要替換這一處）。
 */
export interface Bindings {
  R2: R2Bucket;
  D1?: D1Database;
  TRANSCODER?: { fetch: (req: Request) => Promise<Response> };
  /** 寄信用的獨立 Worker（service binding）。需要網域開啟 Email Routing 且收件人已驗證 */
  MAILER?: { fetch: (req: Request) => Promise<Response> };
}
const holder: { env: Bindings | null } = { env: null };
export const setBindings = (env: unknown) => { holder.env = env as Bindings; };
export function bindings(): Bindings {
  if (!holder.env) throw new Error('Worker 綁定尚未初始化（payload.config 還沒載入）');
  return holder.env;
}
