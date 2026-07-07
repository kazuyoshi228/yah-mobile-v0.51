import * as logger from "firebase-functions/logger";
/**
 * functions/src/scheduled.ts — Consolidated scheduled cron background jobs
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { processPendingRetries } from "./esimRetryService";
import { db } from "./db";
import { notifyOwner } from "./adapters/notify";
import { isBappyConfigured } from "./bappy";
import { fetchNewToken } from "./bappy/auth";

import { defineSecret } from "firebase-functions/params";

const omaxClientId = defineSecret("OMAX_CLIENT_ID");
const omaxClientSecret = defineSecret("OMAX_CLIENT_SECRET");
const gmailUser = defineSecret("GMAIL_USER");
const gmailPass = defineSecret("GMAIL_PASS");
// リトライ結果のオーナー通知（Forge/Slack）で使用
const forgeApiKey = defineSecret("BUILT_IN_FORGE_API_KEY");
const slackWebhookUrl = defineSecret("SLACK_WEBHOOK_URL");
// 最終失敗時の Lane A 自動返金（executeRefund→Stripe）で使用
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
// オーナーへの到達メール（S9）で使用
const ownerEmail = defineSecret("OWNER_EMAIL");

export const esimRetryJob = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "asia-northeast1",
    timeoutSeconds: 300,
    secrets: [omaxClientId, omaxClientSecret, gmailUser, gmailPass, forgeApiKey, slackWebhookUrl, stripeSecretKey, ownerEmail],
  },
  async () => {
    logger.info("[esimRetryJob] Starting eSIM retry job...");
    try {
      const result = await processPendingRetries();
      logger.info(
        `[esimRetryJob] Processed ${result.processed} retries, ${result.succeeded} succeeded, ${result.failed} failed`
      );
    } catch (err) {
      logger.error("[esimRetryJob] Error:", err);
    }
  }
);

/**
 * 宙吊り注文モニター：status="provisioning" のまま30分以上放置された注文を検出しオーナー通知。
 * Webhookがリトライジョブ作成前に落ちた等で、どのジョブにも拾われない注文を拾う安全網。
 * （単一等価クエリ＋in-memory判定で複合インデックス不要）
 */
export const hungOrderMonitor = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "asia-northeast1",
    timeoutSeconds: 120,
    secrets: [forgeApiKey, slackWebhookUrl, gmailUser, gmailPass, ownerEmail],
  },
  async () => {
    try {
      const THIRTY_MIN = 30 * 60 * 1000;
      const cutoff = Date.now() - THIRTY_MIN;
      const snap = await db.collection("orders").where("status", "==", "provisioning").get();
      const hung = snap.docs.filter((d) => {
        const data = d.data() as { updatedAt?: number; createdAt?: number };
        const ts = data.updatedAt ?? data.createdAt ?? 0;
        return ts > 0 && ts < cutoff;
      });
      if (hung.length === 0) {
        logger.info("[hungOrderMonitor] No hung provisioning orders.");
        return;
      }
      logger.warn(`[hungOrderMonitor] ${hung.length} hung provisioning order(s) detected.`);
      const list = hung
        .map((d) => {
          const ts = (d.data() as { updatedAt?: number }).updatedAt ?? 0;
          return `${d.id} (updated ${ts ? new Date(ts).toISOString() : "?"})`;
        })
        .join("\n")
        .slice(0, 1500);
      await notifyOwner({
        title: `⚠️ 宙吊り注文 ${hung.length}件（provisioning が30分以上）`,
        content: list,
      });
    } catch (err) {
      logger.error("[hungOrderMonitor] Error:", err);
    }
  }
);

/**
 * S10 プロバイダ死活/認証監視：Bappy(OMAX)認証を15分ごとにライブ検証し、
 * 401/失敗（＝発行/topup/同期が止まるおそれ）を検知してオーナーへ即通知（S9のメール必達に乗せる）。
 * 2026-07 の「認証失効に4日気づかなかった」インシデントの再発防止。
 * 状態は system_config/provider_health に記録し、通知はデバウンス（down遷移で即／継続は1時間に1回／復旧も1回）。
 * eSIMAccess は柱2導入後に本関数へ追加予定。
 */
export const providerHealthCheck = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "asia-northeast1",
    timeoutSeconds: 120,
    secrets: [omaxClientId, omaxClientSecret, gmailUser, gmailPass, forgeApiKey, slackWebhookUrl, ownerEmail],
  },
  async () => {
    if (!isBappyConfigured()) {
      logger.info("[providerHealthCheck] Bappy not configured (mock). Skipping.");
      return;
    }

    const ONE_HOUR = 60 * 60 * 1000;
    const ref = db.collection("system_config").doc("provider_health");
    const now = Date.now();

    // 認証ping（キャッシュ非経由でライブ検証）
    let ok = false;
    let errMsg = "";
    try {
      await fetchNewToken();
      ok = true;
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
    }

    const snap = await ref.get();
    const prev = (snap.exists ? snap.data()?.bappy : undefined) as
      | { status?: string; lastAlertAt?: number; consecutiveFails?: number }
      | undefined;
    const prevStatus = prev?.status ?? "ok";

    if (ok) {
      if (prevStatus === "down") {
        await notifyOwner({
          critical: true,
          title: "✅ Bappy認証 復旧",
          content: `Bappy(OMAX)認証が回復しました（${new Date(now).toISOString()}）。発行/topup/同期を再開できます。`,
        });
      }
      await ref.set({ bappy: { status: "ok", lastOkAt: now, consecutiveFails: 0 } }, { merge: true });
      logger.info("[providerHealthCheck] Bappy auth OK");
      return;
    }

    // down
    const consecutiveFails = (prev?.consecutiveFails ?? 0) + 1;
    const lastAlertAt = prev?.lastAlertAt ?? 0;
    const isTransition = prevStatus !== "down";
    const shouldRealert = now - lastAlertAt >= ONE_HOUR;

    if (isTransition || shouldRealert) {
      await notifyOwner({
        critical: true,
        title: "🚨 Bappy認証 ダウン（発行系停止のおそれ）",
        content: `Bappy(OMAX)認証に失敗しています。eSIMの発行/topup/同期が止まっている可能性があります。\n\n**連続失敗:** ${consecutiveFails}回\n**エラー:** ${errMsg.slice(0, 500)}\n\n確認：OMAX_CLIENT_ID/OMAX_CLIENT_SECRET（末尾改行等の混入）・Keycloak(id.omaxtelecom.com)への疎通。`,
      });
    }
    await ref.set(
      {
        bappy: {
          status: "down",
          lastDownAt: now,
          lastAlertAt: isTransition || shouldRealert ? now : lastAlertAt,
          consecutiveFails,
        },
      },
      { merge: true },
    );
    logger.error(`[providerHealthCheck] Bappy auth DOWN (fails=${consecutiveFails}): ${errMsg}`);
  }
);
