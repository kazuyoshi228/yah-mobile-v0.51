import * as logger from "firebase-functions/logger";
/**
 * functions/src/scheduled.ts — Consolidated scheduled cron background jobs
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { processPendingRetries } from "./esimRetryService";
import { db } from "./db";
import { notifyOwner } from "./adapters/notify";

import { defineSecret } from "firebase-functions/params";

const omaxClientId = defineSecret("OMAX_CLIENT_ID");
const omaxClientSecret = defineSecret("OMAX_CLIENT_SECRET");
const gmailUser = defineSecret("GMAIL_USER");
const gmailPass = defineSecret("GMAIL_PASS");
// リトライ結果のオーナー通知（Forge/Slack）で使用
const forgeApiKey = defineSecret("BUILT_IN_FORGE_API_KEY");
const slackWebhookUrl = defineSecret("SLACK_WEBHOOK_URL");

export const esimRetryJob = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "asia-northeast1",
    timeoutSeconds: 300,
    secrets: [omaxClientId, omaxClientSecret, gmailUser, gmailPass, forgeApiKey, slackWebhookUrl],
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
    secrets: [forgeApiKey, slackWebhookUrl],
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
