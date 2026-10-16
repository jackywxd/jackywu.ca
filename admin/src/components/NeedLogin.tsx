export function NeedLogin() {
  return (
    <div className="empty" role="alert">
      <p>需要登入。</p>
      <p className="hint">這個後台只有本人能用，由 Cloudflare Access 負責驗證身分。重新整理頁面會再導向登入。</p>
    </div>
  );
}
