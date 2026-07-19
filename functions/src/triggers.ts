import * as logger from "firebase-functions/logger";
/**
 * functions/src/triggers.ts — Consolidated Firebase Firestore & Auth background triggers
 */
import { auth } from "firebase-functions/v1";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirebaseDb, getFirebaseAuth } from "./firebase";
import { ENV } from "./env";
import { updateEsimLink, FsEsimLink } from "./db";

import { getProvider } from "./providers/types";
import { notifyOwner } from "./adapters/notify";
import { sendEmail, buildContactAutoReplyEmail } from "./mailer";
// シークレット宣言は secrets.ts に一元化（P1-1）
import {
  omaxClientId,
  omaxClientSecret,
  gmailUser,
  gmailPass,
  forgeApiKey,
  slackWebhookUrl,
  esimAccessCode,
  esimSecretKey,
  ownerEmail,
} from "./secrets";

const REGION = "asia-northeast1";

// ─── 1. Auth onCreate Trigger (onUserCreated) ────────────────────────────────

export const onUserCreated = auth.user().onCreate(async (user) => {
  // 匿名認証ユーザー（= chat.yah.mobi の全訪問者。Auth はプロジェクト共有）には
  // eSIM 側の users ドキュメントを作らない（loginMethod:"google" のゴミ doc 量産防止）
  if (!user.email && (user.providerData?.length ?? 0) === 0) {
    return;
  }
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
    secrets: [omaxClientId, omaxClientSecret, esimAccessCode, esimSecretKey],
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
        // 有効化（使用開始）の初回検知：eSIMAccess の esimStatus IN_USE 等（既存値は上書きしない）
        ...(detail.activated && after.lastActiveAt == null ? { lastActiveAt: Date.now() } : {}),
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
  // ownerEmail: オーナー向け新規問い合わせ通知に必須（未バインドだと OWNER_EMAIL is not set で
  // 通知が全チャネル失敗する。2026-07-19 に実発生）
  { document: "contact_inquiries/{inquiryId}", region: REGION, secrets: [gmailUser, gmailPass, forgeApiKey, slackWebhookUrl, ownerEmail] },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { name, email, category, message, language } = data as {
      name: string;
      email: string;
      category?: string | null;
      message: string;
      language?: string | null;
    };

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeCategory = escapeHtml(category);
    const safeMessage = escapeHtml(message);

    await notifyOwner({
      title: `新しいお問い合わせ: ${safeName}`,
      // content は notifyViaEmail で HTML に埋め込まれるため、本文も必ずエスケープする
      // （旧実装は safeMessage を定義しながら生 message を注入＝HTMLインジェクション可能だった）
      content: `カテゴリ: ${safeCategory || "未設定"}\nメール: ${safeEmail}\n\n${safeMessage}`,
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

    // お客様へ自動返信メール（フォームのUI言語で6言語出し分け・未設定は en）
    if (email) {
      const autoReply = buildContactAutoReplyEmail({ name, message, language });
      await sendEmail({ to: email, ...autoReply })
        .catch((err) => logger.error("[onContactCreated] Failed to send auto-reply email:", err));
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
