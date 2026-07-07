/**
 * errorReporting.ts — ブラウザの実行時エラーを収集し /api/client-errors へ送る（S1(b)）。
 *
 * 方針：
 *  - PIIを送らない：path のみ（クエリ/ハッシュ除去）、message/name/stack(切詰)/UA/viewport のみ。
 *    メール・トークン・cookie・localStorage は一切送らない。
 *  - 洪水防止：同一(kind+message)は1回だけ／1セッション最大5件／sendBeacon で軽量送信。
 *  - 収集自体で新たなエラーを起こさない（全て try/catch で握る）。
 */
const ENDPOINT = "/api/client-errors";
const MAX_PER_SESSION = 5;
const seen = new Set<string>();
let sent = 0;

function post(payload: Record<string, unknown>): void {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    /* 報告処理でエラーを増やさない */
  }
}

function report(kind: string, message: string, stack?: string): void {
  if (!message || sent >= MAX_PER_SESSION) return;
  const key = `${kind}:${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  post({
    kind,
    name: kind === "unhandledrejection" ? "UnhandledRejection" : "Error",
    message: message.slice(0, 500),
    stack: (stack ?? "").slice(0, 2048),
    page: (typeof window !== "undefined" ? window.location.pathname : "").slice(0, 255), // クエリ/ハッシュ除外
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
    release: (import.meta.env?.VITE_RELEASE as string | undefined) ?? "dev",
    ts: Date.now(),
  });
}

export function initErrorReporting(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e: ErrorEvent) => {
    report("error", e.message || String(e.error?.message ?? "error"), e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    report("unhandledrejection", msg, stack);
  });
}
