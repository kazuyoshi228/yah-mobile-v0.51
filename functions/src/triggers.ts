import * as logger from "firebase-functions/logger";
/**
 * functions/src/triggers.ts — Consolidated Firebase Firestore & Auth background triggers
 */
import { auth } from "firebase-functions/v1";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { getFirebaseDb, getFirebaseAuth } from "./firebase";
import { ENV } from "./env";
import { updateEsimLink, FsEsimLink } from "./db";

import { getProvider } from "./providers/types";
import { notifyOwner } from "./adapters/notify";
import { sendEmail } from "./mailer";

const REGION = "asia-northeast1";

// Secret Manager references — makes secrets available as process.env in the function
const omaxClientId = defineSecret("OMAX_CLIENT_ID");
const omaxClientSecret = defineSecret("OMAX_CLIENT_SECRET");
const gmailUser = defineSecret("GMAIL_USER");
const gmailPass = defineSecret("GMAIL_PASS");
// お問い合わせ通知のオーナー通知（Forge/Slack）で使用
const forgeApiKey = defineSecret("BUILT_IN_FORGE_API_KEY");
const slackWebhookUrl = defineSecret("SLACK_WEBHOOK_URL");

// ─── 1. Auth onCreate Trigger (onUserCreated) ────────────────────────────────

export const onUserCreated = auth.user().onCreate(async (user) => {
  const db = getFirebaseDb();
  const userRef = db.collection("users").doc(user.uid);
  const now = Date.now();

  // オーナーメールの場合は admin ロールを付与
  const isOwnerEmail = !!user.email && user.email.toLowerCase() === ENV.ownerEmail;
  const role = isOwnerEmail ? "admin" : "user";

  try {
    const existing = await userRef.get();
    if (!existing.exists) {
      await userRef.set({
        uid: user.uid,
        name: user.displayName ?? user.email?.split("@")[0] ?? "User",
        email: user.email ?? "",
        loginMethod: "google",
        role,
        status: "active",
        createdAt: now,
        lastSignedIn: now,
        updatedAt: now,
      });
      logger.info(`[onUserCreated] Created /users/${user.uid} with role: ${role}`);
    } else {
      await userRef.update({
        lastSignedIn: now,
        updatedAt: now,
      });
      logger.info(`[onUserCreated] Updated lastSignedIn for /users/${user.uid}`);
    }
    // Custom Claims を Firestore role と同期
    await getFirebaseAuth().setCustomUserClaims(user.uid, { admin: role === "admin" });
    logger.info(`[onUserCreated] Set Custom Claims { admin: ${role === "admin"} } for ${user.uid}`);
  } catch (err) {
    logger.error(`[onUserCreated] Failed to create/update /users/${user.uid}:`, err);
  }
});

// ─── 2. (Removed onOrderCreated Trigger) ───────────────────────────────────────


// ─── 3. Firestore eSIM Sync Trigger (onEsimSyncRequested) ─────────────────────

export const onEsimSyncRequested = onDocumentUpdated(
  {
    document: "esim_links/{linkId}",
    region: REGION,
    secrets: [omaxClientId, omaxClientSecret],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    if (before.syncRequestedAt === after.syncRequestedAt) return;
    if (!after.syncRequestedAt) return;

    const linkId = event.params.linkId;
    const bappyLinkUuid = after.bappyLinkUuid as string;

    if (!bappyLinkUuid) {
      logger.error(`[onEsimSyncRequested] bappyLinkUuid not found for linkId: ${linkId}`);
      return;
    }

    logger.info(`[onEsimSyncRequested] Syncing eSIM data for linkId: ${linkId}, uuid: ${bappyLinkUuid}`);

    try {
      const provider = after.provider as string | undefined;
      const providerRef = (after.providerRef as string | undefined) ?? bappyLinkUuid;
      const detail = await getProvider(provider).getEsimDetail(providerRef);
      await updateEsimLink(bappyLinkUuid, {
        status: detail.status as FsEsimLink["status"],
        dataRemainingMb: detail.dataRemainingMb ?? null,
        dataTotalMb: detail.dataTotalMb ?? null,
        expiryDate: detail.expiryDate, // provider が epoch ms に正規化済み
      });
      logger.info(`[onEsimSyncRequested] Sync complete for linkId: ${linkId}`);
    } catch (err) {
      logger.error(`[onEsimSyncRequested] Failed to sync eSIM data for linkId: ${linkId}`, err);
    }
  }
);

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── 4. Firestore Contact Create Trigger (onContactCreated) ───────────────────

export const onContactCreated = onDocumentCreated(
  { document: "contact_inquiries/{inquiryId}", region: REGION, secrets: [gmailUser, gmailPass, forgeApiKey, slackWebhookUrl] },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { name, email, category, message } = data as {
      name: string;
      email: string;
      category?: string | null;
      message: string;
    };

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeCategory = escapeHtml(category);
    const safeMessage = escapeHtml(message);

    await notifyOwner({
      title: `新しいお問い合わせ: ${safeName}`,
      content: `カテゴリ: ${safeCategory || "未設定"}\nメール: ${safeEmail}\n\n${message}`, // Slack/Discord notifications might not need HTML escaping, but using raw message is fine since it's text.
    }).catch((err) =>
      logger.error("[onContactCreated] notify error:", err)
    );

    // 管理者（オーナー）へメール通知
    if (ENV.ownerEmail) {
      await sendEmail({
        to: ENV.ownerEmail,
        subject: `【yah.mobile】新しいお問い合わせを受信しました`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px;">
            <h2>お問い合わせ内容</h2>
            <p><strong>名前:</strong> ${safeName || "未入力"}</p>
            <p><strong>メールアドレス:</strong> ${safeEmail}</p>
            <p><strong>カテゴリ:</strong> ${safeCategory || "未設定"}</p>
            <div style="background: #f8f8f8; padding: 16px; margin-top: 16px; border-radius: 4px;">
              ${safeMessage.replace(/\n/g, "<br>")}
            </div>
          </div>
        `,
      }).catch((err) => logger.error("[onContactCreated] Failed to send admin email:", err));
    }

    // お客様へ自動返信メール
    if (email) {
      await sendEmail({
        to: email, // use original email for sending
        subject: `【yah.mobile】お問い合わせを受け付けました`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px;">
            <p>${safeName || "お客様"} 様</p>
            <p>お問い合わせありがとうございます。<br>以下の内容で受け付けました。<br>担当者より順次ご返信いたしますので、今しばらくお待ちください。</p>
            <div style="background: #f8f8f8; padding: 16px; margin-top: 16px; border-radius: 4px;">
              <strong>【送信内容】</strong><br>
              ${safeMessage.replace(/\n/g, "<br>")}
            </div>
            <p style="color: #888; font-size: 12px; margin-top: 24px;">
              ※本メールは自動送信です。このメールに心当たりがない場合は破棄してください。
            </p>
          </div>
        `,
      }).catch((err) => logger.error("[onContactCreated] Failed to send auto-reply email:", err));
    }
  }
);

// ─── 5. Admin Security Audit Triggers (BaaS First) ───────────────────────────

export const onAllowedEmailWritten = onDocumentWritten(
  { document: "allowed_emails/{email}", region: REGION },
  (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const after = event.data?.after.exists ? event.data.after.data() : null;
    const email = event.params.email;

    if (!before && after) {
      logger.info(`[Admin Audit] Allowed email added directly via Firestore: ${email}`);
    } else if (before && !after) {
      logger.info(`[Admin Audit] Allowed email deleted directly via Firestore: ${email}`);
    } else if (before && after) {
      logger.info(`[Admin Audit] Allowed email updated directly via Firestore: ${email}`);
    }
  }
);

export const onInquiryUpdated = onDocumentUpdated(
  { document: "contact_inquiries/{inquiryId}", region: REGION },
  (event) => {
    const inquiryId = event.params.inquiryId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (before?.status !== after?.status) {
      logger.info(`[Admin Audit] Inquiry ${inquiryId} status updated from ${before?.status} to ${after?.status} directly via Firestore`);
    }
  }
);

export const onUserUpdated = onDocumentUpdated(
  { document: "users/{uid}", region: REGION },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    // Check if sessionRevokedAt was newly set or changed
    const beforeRevoked = before?.sessionRevokedAt?.toMillis ? before.sessionRevokedAt.toMillis() : 0;
    const afterRevoked = after?.sessionRevokedAt?.toMillis ? after.sessionRevokedAt.toMillis() : 0;

    if (afterRevoked > beforeRevoked) {
      logger.info(`[Admin Audit] Session revocation requested for user ${uid}. Executing...`);
      try {
        await getFirebaseAuth().revokeRefreshTokens(uid);
        logger.info(`[Admin Audit] Successfully revoked sessions for user ${uid}.`);
      } catch (err) {
        logger.error(`[Admin Audit] Failed to revoke sessions for user ${uid}:`, err);
      }
    }
  }
);
