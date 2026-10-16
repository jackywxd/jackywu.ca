/**
 * 通知：發佈是無人值守的，結果一定要主動告訴本人（成功、失敗、看門狗、送不出去）。
 * 純函式組信；真正寄出由注入的 send 負責（正式環境是 Cloudflare 的 send_email 綁定）。
 * 寄信失敗絕不能影響發佈流程：只記 log。
 */
import type { Notice } from './publish-service';

export interface Mail { subject: string; text: string }

const KIND_LABEL: Record<string, string> = { publish: '發佈', unpublish: '撤下', delete: '刪除' };

export function formatNotice(n: Notice, adminUrl: string): Mail | null {
  const r = n.request;
  const what = r ? `${KIND_LABEL[r.kind] ?? r.kind} ${r.collection}/${r.docId}` : '';
  const link = `${adminUrl}/system`;
  switch (n.kind) {
    case 'published':
      return { subject: `已上線：${what}`, text: `${what} 已經上線。\n\n${link}\n` };
    case 'failed': {
      const f = r?.failure;
      if (f?.check === 'rollback') {
        return {
          subject: `線上可能是壞掉的版本：${what}`,
          text: `${what} 部署後 smoke 沒有通過，而且自動回滾也失敗了：線上可能正停在壞掉的版本，需要人處理。\n\n${f.summary ?? ''}\n${f.runUrl ? `\n完整記錄：${f.runUrl}\n` : ''}\n${link}\n`,
        };
      }
      return {
        subject: `沒有上線：${what}（${f?.check ?? '未知'}）`,
        text: `${what} 沒有上線，網站維持上一版。\n\n擋下的檢查：${f?.check ?? '未知'}\n${f?.summary ?? ''}\n${f?.runUrl ? `\n完整記錄：${f.runUrl}\n` : ''}\n修正後在後台再按一次發佈：${link}\n`,
      };
    }
    case 'watchdog':
      return { subject: `發佈卡住被收掉：${what}`, text: `${what} 超過時限沒有結果，已標成失敗，佇列繼續處理下一筆。\n\n原因：${n.detail ?? ''}\n\n${link}\n` };
    case 'revoke-aborted':
      return {
        subject: `公開媒體的撤回被擋下：${what}`,
        text: `${what} 已上線，但不再被引用的公開影片／GPX 沒有撤回：一次要撤的數量超過上限，可能是拉到不完整的資料。\n\n${n.detail ?? ''}\n\n這些檔案仍然可以從公開網址取得。確認內容正常後，下一次發佈會再試一次。\n${link}\n`,
      };
    case 'dispatch-error':
      return { subject: `發佈送不出去：${what}`, text: `向 GitHub 送出 ${what} 失敗，稍後會自動重試。\n\n原因：${n.detail ?? ''}\n\n如果一直重複出現，檢查 GitHub App 的設定。\n${link}\n` };
    default:
      return null;
  }
}

/** RFC 2047：非 ASCII 的主旨要編碼，否則信箱顯示成亂碼 */
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const subjectHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s: string) => s.replace(/(.{76})/g, '$1\r\n');

export function buildMime(args: { from: string; to: string; subject: string; text: string; messageId: string; date: Date }): string {
  const h = [
    `From: ${args.from}`, `To: ${args.to}`, `Subject: ${subjectHeader(args.subject)}`,
    `Date: ${args.date.toUTCString()}`, `Message-ID: <${args.messageId}>`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
  ];
  return `${h.join('\r\n')}\r\n\r\n${wrap76(b64(args.text))}\r\n`;
}

export type SendRaw = (from: string, to: string, raw: string) => Promise<void>;

export function emailNotifier(o: { send: SendRaw; from: string; to: string; adminUrl: string; log: (m: string) => void; now?: () => Date; deliver?: (mail: Mail) => Promise<void> }) {
  return async (n: Notice) => {
    const mail = formatNotice(n, o.adminUrl);
    if (!mail) return;
    try {
      // deliver：直接交出主旨與內文，由寄信的 Worker 組 MIME 並決定寄給誰
      if (o.deliver) { await o.deliver(mail); return; }
      const d = (o.now ?? (() => new Date()))();
      await o.send(o.from, o.to, buildMime({ from: o.from, to: o.to, ...mail, messageId: `${d.getTime().toString(36)}.${Math.random().toString(36).slice(2)}@jackywu.ca`, date: d }));
    } catch (e) {
      o.log(`通知信寄不出去（不影響發佈）：${(e as Error).message}`);
    }
  };
}
