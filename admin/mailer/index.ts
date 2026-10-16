import { EmailMessage } from 'cloudflare:email';
import { handleSend, type MailerEnv } from './handler';

interface Env extends MailerEnv { EMAIL: { send: (m: unknown) => Promise<void> } }

export default {
  fetch: (req: Request, env: Env) => handleSend(req, env, (from, to, raw) => env.EMAIL.send(new EmailMessage(from, to, raw))),
};
