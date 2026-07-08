/**
 * chatBridge.ts — chat ウィジェット（chat.yah.mobi iframe）への認証SSO橋渡し（batch2-A）
 *
 * 仕組み:
 *  - iframe からの `yah:request-auth`（origin=chat.yah.mobi のみ受理）に対し、
 *    ログイン中なら Firebase IDトークンを `yah:auth-token` で返す。未ログインは `yah:auth-none`。
 *  - ログイン/ログアウトの変化時も、埋め込まれている chat iframe へ能動的に通知する。
 *  - chat 側は受け取った IDトークンを callable（ssoExchange: verifyIdToken→createCustomToken）で
 *    カスタムトークンに交換し signInWithCustomToken → yah.mobi と同一 uid でサインインする。
 *
 * セキュリティ:
 *  - 受信は event.origin の完全一致検証。送信は targetOrigin を CHAT_ORIGIN に固定。
 *  - IDトークンは同一 Firebase プロジェクトの正規トークン（chat 側で verifyIdToken 検証）。
 *  - 本ブリッジは Firebase を追加ロードしない（動的 import。firebase 未初期化なら auth-none）。
 */
const CHAT_ORIGIN = "https://chat.yah.mobi";

type AuthRequestMsg = { type: "yah:request-auth" };

function isAuthRequest(data: unknown): data is AuthRequestMsg {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "yah:request-auth";
}

async function currentIdToken(): Promise<string | null> {
  try {
    const { getIdToken } = await import("@/lib/firebase");
    return await getIdToken();
  } catch {
    return null;
  }
}

function postToSource(source: MessageEventSource | null, token: string | null): void {
  if (!source || !("postMessage" in source)) return;
  const msg = token ? { type: "yah:auth-token", token } : { type: "yah:auth-none" };
  (source as Window).postMessage(msg, CHAT_ORIGIN);
}

/** ページ内の chat iframe（widget.js が注入）を探す。 */
function findChatIframe(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>(`iframe[src^="${CHAT_ORIGIN}"]`);
}

export function initChatAuthBridge(): void {
  if (typeof window === "undefined") return;

  // iframe からの要求に応答
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== CHAT_ORIGIN) return;
    if (!isAuthRequest(event.data)) return;
    void currentIdToken().then((token) => postToSource(event.source, token));
  });

  // ログイン状態の変化を（開いている）chat iframe へ通知。
  // firebase 本体のロードを遅らせないよう、初回アイドル時に購読を張る。
  const subscribe = () => {
    import("@/lib/firebase")
      .then(({ subscribeAuthState, getIdToken }) => {
        subscribeAuthState((user) => {
          const iframe = findChatIframe();
          if (!iframe?.contentWindow) return;
          if (!user) {
            iframe.contentWindow.postMessage({ type: "yah:auth-none" }, CHAT_ORIGIN);
            return;
          }
          void getIdToken().then((token) => {
            if (token) iframe.contentWindow?.postMessage({ type: "yah:auth-token", token }, CHAT_ORIGIN);
          });
        });
      })
      .catch(() => undefined);
  };
  if ("requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(subscribe);
  } else {
    setTimeout(subscribe, 3000);
  }
}
