import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db, collections, updateEsimLink, getEsimLinkByOrderId, createNotification } from "./db";
import { esimaccessProvider } from "./providers/esimaccess";
import { esimAccessCode, esimSecretKey } from "./esimaccess/auth";
import { notifyOwner } from "./adapters/notify";
import type { FsEsimLink } from "../../shared/types";

/**
 * webhooks_esimaccess.ts — eSIMAccess 受信Webhook（柱1＝多層防御 / 柱2 §7）
 *
 * エンベロープ: { notifyType, notifyId, eventGenerateTime, content }
 * 多層防御:
 *  1. 秘密トークンURL（?token=<ESIMACCESS_WEBHOOK_TOKEN>）— 主たる認証ゲート。
 *  2. 送信元IP許可（公式5IP）— 監視レイヤ（不一致は通知・ログ。トークンが真正性を担保）。
 *  3. 裏取り（/esim/query）— content を鵜呑みにせず権威データで Firestore 更新。
 *  4. notifyId 冪等 — 重複は無視。CHECK_HEALTH は 200。
 */

// 秘密トークンURL（/webhook/save で推測不能URLを登録）。値は Secret Manager。
const esimaccessWebhookToken = defineSecret("ESIMACCESS_WEBHOOK_TOKEN");
const forgeApiKey = defineSecret("BUILT_IN_FORGE_API_KEY");
const slackWebhookUrl = defineSecret("SLACK_WEBHOOK_URL");

// 公式・送信元IPホワイトリスト（esimaccess_api_notes.md）
const ALLOWED_IPS = new Set([
  "3.1.131.226",
  "54.254.74.88",
  "18.136.190.97",
  "18.136.60.197",
  "18.136.19.137",
]);

const MAX_DATA_MB = 1_000_000; // 1TB 上限（範囲外は無視）

// X-Forwarded-For / req.ip から候補IPを集める（GFE経由。監視目的なので緩めに集約）。
function candidateIps(req: { ip?: string; headers: Record<string, unknown> }): string[] {
  const xff = req.headers["x-forwarded-for"];
  const list: string[] = [];
  if (typeof xff === "string") list.push(...xff.split(",").map((s) => s.trim()));
  else if (Array.isArray(xff)) for (const v of xff) list.push(...String(v).split(",").map((s) => s.trim()));
  if (req.ip) list.push(req.ip);
  return list.filter(Boolean);
}

// notifyId 冪等：create() は既存で失敗する＝重複。true=初回処理、false=重複。
async function claimNotifyId(notifyId: string): Promise<boolean> {
  try {
    await db.collection("esimaccess_webhook_events").doc(notifyId).create({ processedAt: Date.now() });
    return true;
  } catch {
    return false; // already-exists
  }
}

// content の transactionId(=当社orderId) か iccid から esim_link を引く。
async function findEsimLink(content: Record<string, unknown>): Promise<FsEsimLink | null> {
  const txId = typeof content.transactionId === "string" ? content.transactionId : null;
  if (txId) {
    const byOrder = await getEsimLinkByOrderId(txId);
    if (byOrder) return byOrder;
  }
  const iccid = typeof content.iccid === "string" ? content.iccid : null;
  if (iccid) {
    const snap = await collections.esimLinks.where("iccid", "==", iccid).limit(1).get();
    if (!snap.empty) return snap.docs[0].data() as FsEsimLink;
  }
  return null;
}

// 裏取り：providerRef(esimTranNo) で /esim/query し、権威データで esim_link を更新。
async function reconcileFromProvider(link: FsEsimLink): Promise<FsEsimLink | null> {
  const providerRef = link.providerRef ?? link.bappyLinkUuid;
  if (!providerRef) return null;
  const detail = await esimaccessProvider.getEsimDetail(providerRef);
  const updates: Partial<FsEsimLink> = { updatedAt: Date.now() };
  if (detail.status) updates.status = detail.status as FsEsimLink["status"];
  if (detail.iccid) updates.iccid = detail.iccid;
  if (detail.lpaProfile) updates.lpaProfile = detail.lpaProfile;
  if (detail.dataRemainingMb != null && detail.dataRemainingMb >= 0 && detail.dataRemainingMb <= MAX_DATA_MB) {
    updates.dataRemainingMb = detail.dataRemainingMb;
  }
  if (detail.dataTotalMb != null) updates.dataTotalMb = detail.dataTotalMb;
  if (detail.expiryDate != null) updates.expiryDate = detail.expiryDate;
  await updateEsimLink(providerRef, updates);
  return { ...link, ...updates };
}

export const esimaccessWebhook = onRequest(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    secrets: [esimaccessWebhookToken, esimAccessCode, esimSecretKey, forgeApiKey, slackWebhookUrl],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // ── 層1: 秘密トークンURL（主認証）──
    const expected = esimaccessWebhookToken.value();
    const got = typeof req.query.token === "string" ? req.query.token : "";
    if (!expected || got !== expected) {
      logger.warn("[esimaccessWebhook] rejected: bad/missing token");
      res.status(403).send("Forbidden");
      return;
    }

    // ── 層2: 送信元IP（監視。トークン真正なので不一致でも処理は続けるが通知）──
    const ips = candidateIps(req);
    const ipOk = ips.some((ip) => ALLOWED_IPS.has(ip));
    if (!ipOk) {
      logger.warn(`[esimaccessWebhook] source IP not in allowlist: ${ips.join(",")}`);
      notifyOwner({
        title: "eSIMAccess Webhook: 想定外の送信元IP",
        content: `トークンは一致しましたが、送信元IPが許可リスト外です: ${ips.join(", ") || "(不明)"}。攻撃の可能性またはeSIMAccessのIP変更。`,
      }).catch(() => undefined);
    }

    const body = (req.body ?? {}) as {
      notifyType?: string;
      notifyId?: string;
      content?: Record<string, unknown>;
    };
    const notifyType = body.notifyType ?? "";
    const notifyId = body.notifyId ?? "";
    const content = body.content ?? {};

    // 設定確認は 200 を返すだけ
    if (notifyType === "CHECK_HEALTH") {
      res.json({ received: true });
      return;
    }
    // 超高頻度の SMDP 診断イベントは業務ロジック不要（200のみ）
    if (notifyType === "SMDP_EVENT") {
      res.json({ received: true, ignored: true });
      return;
    }

    if (!notifyId) {
      res.status(400).send("Missing notifyId");
      return;
    }

    // ── 層4: notifyId 冪等 ──
    const fresh = await claimNotifyId(notifyId);
    if (!fresh) {
      logger.info(`[esimaccessWebhook] duplicate notifyId ${notifyId} — ignored`);
      res.json({ received: true, duplicate: true });
      return;
    }

    try {
      switch (notifyType) {
        case "ORDER_STATUS":
        case "ESIM_STATUS": {
          // ── 層3: 裏取り（/esim/query）→ esim_link 更新 ──
          const link = await findEsimLink(content);
          if (!link) {
            logger.warn(`[esimaccessWebhook] ${notifyType}: esim_link not found for ${JSON.stringify(content).slice(0, 200)}`);
            break;
          }
          await reconcileFromProvider(link);
          logger.info(`[esimaccessWebhook] ${notifyType} reconciled for ${link.providerRef ?? link.id}`);
          break;
        }
        case "DATA_USAGE":
        case "VALIDITY_USAGE": {
          const link = await findEsimLink(content);
          if (!link) {
            logger.warn(`[esimaccessWebhook] ${notifyType}: esim_link not found`);
            break;
          }
          const reconciled = (await reconcileFromProvider(link)) ?? link;
          // 顧客への残量/期限アラート（本文は client 側で i18n。英語フォールバックを保存）
          const isData = notifyType === "DATA_USAGE";
          await createNotification({
            userId: reconciled.userId,
            title: isData ? "Data running low" : "eSIM expiring soon",
            body: isData
              ? "Your eSIM data is almost used up. You can top up from My Page."
              : "Your eSIM is about to expire. You can buy a new plan from My Page.",
            type: isData ? "data_threshold_100" : "system",
            orderId: reconciled.orderId ?? null,
          }).catch((e) => logger.error(`[esimaccessWebhook] notification failed:`, e));
          logger.info(`[esimaccessWebhook] ${notifyType} alert sent for ${reconciled.providerRef ?? reconciled.id}`);
          break;
        }
        default:
          logger.warn(`[esimaccessWebhook] unhandled notifyType "${notifyType}"`);
      }
      res.json({ received: true });
    } catch (err) {
      logger.error(`[esimaccessWebhook] error processing ${notifyType}/${notifyId}:`, err);
      notifyOwner({
        title: "eSIMAccess Webhook 処理失敗",
        content: `type=${notifyType} notifyId=${notifyId}\n${String(err).slice(0, 500)}`,
      }).catch(() => undefined);
      // 失敗時は notifyId の claim を解除し、eSIMAccess の再送で再処理できるようにする。
      await db.collection("esimaccess_webhook_events").doc(notifyId).delete().catch(() => undefined);
      res.status(500).send("Internal server error");
    }
  },
);
