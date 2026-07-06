import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { collections, updateEsimLink } from "./db";
import { notifyOwner } from "./adapters/notify";

// オーナー通知（Forge/Slack）用シークレット
const forgeApiKey = defineSecret("BUILT_IN_FORGE_API_KEY");
const slackWebhookUrl = defineSecret("SLACK_WEBHOOK_URL");

// 受理する eventType の許可リスト（未知のイベントは無視してログのみ）
const KNOWN_EVENT_TYPES = new Set([
  "esim_installed",
  "activation_started",
  "data_depleted",
  "expired",
  "data_threshold_80",
  "status_changed",
]);
// usage_logs に追記する notable イベント
const NOTABLE_EVENT_TYPES = new Set([
  "data_threshold_80",
  "data_depleted",
  "esim_installed",
  "activation_started",
  "status_changed",
]);
// データ残量の妥当な上限（1TB=1,000,000MB）。範囲外は不正値として無視する。
const MAX_DATA_REMAINING_MB = 1_000_000;

export const bappyWebhook = onRequest(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    secrets: [forgeApiKey, slackWebhookUrl],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // TODO: Verify Bappy signature here if/when provided
    // const sig = req.headers["x-bappy-signature"]; 

    const body = req.body as {
      eventType?: string;
      bappyLinkUuid?: string;
      dataRemainingMb?: number;
      installedDeviceModel?: string;
      detail?: string;
    };

    const { eventType, bappyLinkUuid, dataRemainingMb, installedDeviceModel, detail } = body;

    if (!bappyLinkUuid) {
      res.status(400).send("Missing bappyLinkUuid");
      return;
    }

    // 未知の eventType は状態を書き換えず、ログのみ残して無視する（不正値注入対策）
    if (eventType && !KNOWN_EVENT_TYPES.has(eventType)) {
      logger.warn(`[bappyWebhook] Ignored unknown eventType "${eventType}" for link ${bappyLinkUuid}`);
      res.json({ received: true, ignored: true });
      return;
    }

    // dataRemainingMb は 0〜上限の有限数のみ受理（範囲外・NaNは無視）
    const validDataRemainingMb =
      typeof dataRemainingMb === "number" &&
      Number.isFinite(dataRemainingMb) &&
      dataRemainingMb >= 0 &&
      dataRemainingMb <= MAX_DATA_REMAINING_MB
        ? dataRemainingMb
        : null;

    try {
      const now = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: any = { updatedAt: now };

      if (validDataRemainingMb !== null) {
        updates.dataRemainingMb = validDataRemainingMb;
      }
      if (installedDeviceModel) {
        updates.installedDeviceModel = String(installedDeviceModel).slice(0, 100);
      }

      // status mapping based on eventType
      if (eventType === "esim_installed" || eventType === "activation_started") {
        updates.status = "active";
        updates.lastActiveAt = now;
      } else if (eventType === "data_depleted" || eventType === "expired") {
        updates.status = "expired";
      }

      // 1. Update esim_links document
      await updateEsimLink(bappyLinkUuid, updates);

      // 2. Append to usage_logs if it's a notable event
      if (eventType && NOTABLE_EVENT_TYPES.has(eventType)) {
        await collections.esimLinks.doc(bappyLinkUuid).collection("usage_logs").add({
          timestamp: now,
          eventType,
          dataRemainingMb: validDataRemainingMb,
          detail: detail ? String(detail).slice(0, 500) : null,
        });
      }

      logger.info(`[bappyWebhook] Processed event ${eventType} for link ${bappyLinkUuid}`);
      res.json({ received: true });
    } catch (err) {
      logger.error(`[bappyWebhook] Error processing event for ${bappyLinkUuid}:`, err);
      // 処理失敗をオーナーに通知（ログを見ていなくても気づけるように）。通知失敗は握りつぶす。
      try {
        await notifyOwner({
          title: "Bappy Webhook 処理失敗",
          content: `link=${bappyLinkUuid ?? "?"} event=${eventType ?? "?"}\n${String(err).slice(0, 500)}`,
        });
      } catch (notifyErr) {
        logger.error("[bappyWebhook] notifyOwner failed:", notifyErr);
      }
      res.status(500).send("Internal server error");
    }
  }
);
