/**
 * db/infra.ts — 横断的な小さめのリポジトリ群（P2・db.ts から無編集移動）
 *  - Bappyトークンキャッシュ / Stripeイベント冪等 / plans読み取り / 同意記録 / 監査ログ / 売上統計
 */
import { collections, docToObj, queryToArr, FieldValue } from "./core";
import type { FsPlan, FsStripeEvent, FsUserConsent } from "./core";

export async function getBappyToken(): Promise<{ accessToken: string; expiresAt: number } | null> {
  const snap = await collections.bappyTokenCache.doc("singleton").get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return { accessToken: data.accessToken, expiresAt: data.expiresAt };
}

export async function setBappyToken(accessToken: string, expiresAt: number): Promise<void> {
  await collections.bappyTokenCache.doc("singleton").set({
    accessToken,
    expiresAt,
    updatedAt: Date.now(),
  });
}

export async function getBappyTokenCached(): Promise<string | null> {
  const result = await getBappyToken();
  if (!result) return null;
  if (Date.now() >= result.expiresAt) return null;
  return result.accessToken;
}

export async function setBappyTokenCached(accessToken: string, expiresInSeconds: number): Promise<void> {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  await setBappyToken(accessToken, expiresAt);
}

export async function getActivePlans(): Promise<FsPlan[]> {
  const snap = await collections.plans.get();
  const all = queryToArr<FsPlan>(snap);
  return all
    .filter((p) => p.isActive === true)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

// NOTE: プランの作成・更新・削除は管理画面から Firestore へ直接書き込む（BaaS First）。
// バックエンドは読み取り専用の getActivePlans（llms.txt 用）のみを保持する。
// かつてドキュメントID == bappyPlanId を前提としたヘルパー群が存在したが、
// 管理画面は自動IDで作成するため規約が二重化していた。全て bappyPlanId フィールド
// クエリに統一し、doc-ID 前提のヘルパーは削除した。

export async function getStripeEvent(stripeEventId: string): Promise<FsStripeEvent | null> {
  const snap = await collections.stripeEvents.doc(stripeEventId).get();
  return docToObj<FsStripeEvent>(snap);
}

export async function isStripeEventProcessed(stripeEventId: string): Promise<boolean> {
  const event = await getStripeEvent(stripeEventId);
  return event?.processed === true;
}

export async function createUserConsent(data: Omit<FsUserConsent, "id">): Promise<FsUserConsent> {
  const ref = await collections.userConsents.add(data);
  const snap = await ref.get();
  return docToObj<FsUserConsent>(snap)!;
}

export async function getUserConsents(userId: string): Promise<FsUserConsent[]> {
  const snap = await collections.userConsents.where("userId", "==", userId).get();
  return queryToArr<FsUserConsent>(snap);
}

export async function recordConsents(data: {
  userId: string;
  termsGranted: boolean;
  privacyGranted: boolean;
  marketingGranted: boolean;
  version: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  const now = Date.now();
  await Promise.all([
    createUserConsent({
      userId: data.userId,
      consentType: "terms",
      version: data.version,
      granted: data.termsGranted,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      consentedAt: now,
    }),
    createUserConsent({
      userId: data.userId,
      consentType: "privacy",
      version: data.version,
      granted: data.privacyGranted,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      consentedAt: now,
    }),
    createUserConsent({
      userId: data.userId,
      consentType: "marketing",
      version: data.version,
      granted: data.marketingGranted,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      consentedAt: now,
    }),
  ]);
}

export async function insertAuditLog(data: {
  actorId?: string | null;
  action: string;
  targetTable: string;
  targetId: string;
  diff?: Record<string, unknown> | null;
  ipAddress?: string | null;
}): Promise<void> {
  await collections.auditLogs.add({ ...data, createdAt: Date.now() });
}

// ─── System Stats Helpers ─────────────────────────────────────────────────────
export async function incrementSystemStats(amountJpy: number): Promise<void> {
  const ref = collections.systemStats.doc("global");
  await ref.set(
    {
      totalRevenueJpy: FieldValue.increment(amountJpy),
      totalOrders: FieldValue.increment(1),
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}
