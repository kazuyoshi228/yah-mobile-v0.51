import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { ENV } from "./env";
import { enforceRateLimit } from "./rateLimit";

/**
 * clientErrorLog — フロント（ブラウザ）の実行時エラーを受け取り Cloud Logging に出力する。
 * ERROR 重大度で出すことで Cloud Error Reporting がバックエンドのエラーと同じ画面に集約する。
 *
 * `analyticsEvents` と同型：onRequest ＋ CORS ＋ IPレート制限 ＋ POST限定 ＋ サイズ制限。
 * Firestore には書かない（ログのみ・storage/rules を増やさない）。
 * PII はクライアント側で除去済み（path のみ・クエリ/ハッシュ無し）だが、サーバ側でも長さを切り詰める。
 */
export const clientErrorLog = onRequest(
  {
    region: "asia-northeast1",
    timeoutSeconds: 15,
    cors: ENV.allowedOrigins as unknown as string[],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    // 無認証エンドポイントのスパム対策（IPレート制限）
    const rawIp = (req.headers["x-forwarded-for"] as string | undefined) || req.ip || "unknown";
    const ip = rawIp.split(",")[0].trim();
    try {
      await enforceRateLimit(`clienterr:${ip}`, 60, 60); // 1分あたり60件まで
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "resource-exhausted") {
        res.status(429).json({ ok: false, error: "rate-limited" });
        return;
      }
      logger.warn("[clientErrorLog] rate limiter error, allowing:", e);
    }

    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const message = String(b.message ?? "").slice(0, 500);
      if (!message) {
        res.json({ ok: true });
        return;
      }
      const name = String(b.name ?? "Error").slice(0, 80);
      const stack = String(b.stack ?? "").slice(0, 2048);
      const page = String(b.page ?? "").slice(0, 255); // path のみ（クライアントでクエリ除去済み）
      const ua = String(b.userAgent ?? "").slice(0, 512);
      const viewport = String(b.viewport ?? "").slice(0, 24);
      const release = String(b.release ?? "").slice(0, 40);
      const kind = String(b.kind ?? "error").slice(0, 24); // "error" | "unhandledrejection"

      logger.error(
        `[clientError] ${name}: ${message}\npage=${page} kind=${kind} viewport=${viewport} release=${release}\nua=${ua}\n${stack}`,
      );
      res.json({ ok: true });
    } catch (err) {
      // フロントのエラー報告処理でさらにエラーを増やさない（200で握る）
      logger.warn("[clientErrorLog] Error processing report:", err);
      res.status(200).json({ ok: false });
    }
  },
);
