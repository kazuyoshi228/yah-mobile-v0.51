/**
 * db/core.ts — Firestore 接続・コレクション参照・汎用変換ユーティリティ（P2）
 *
 * このファイルは db/ 配下の「葉」：他の db/* を import しない（循環依存防止）。
 * 消費側は従来どおり ../db（バレル）から import する。
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseDb } from "../firebase";

export const db = getFirebaseDb();

// ─── Core Utilities ────────────────────────────────────────────────────────────

export function toMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number") return val;
  return Date.now();
}

export function docToObj<T>(snap: FirebaseFirestore.DocumentSnapshot): T | null {
  if (!snap.exists) return null;
  const data = snap.data()!;
  return { id: snap.id, ...data } as T;
}

export function queryToArr<T>(snap: FirebaseFirestore.QuerySnapshot): T[] {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
}

export const collections = {
  users: db.collection("users"),
  plans: db.collection("plans"),
  orders: db.collection("orders"),
  esimLinks: db.collection("esim_links"),
  esimActivations: db.collection("esim_activations"),
  bappyTokenCache: db.collection("bappy_token_cache"),
  stripeEvents: db.collection("stripe_events"),
  auditLogs: db.collection("audit_logs"),
  notifications: db.collection("notifications"),
  contactInquiries: db.collection("contact_inquiries"),
  analyticsEvents: db.collection("analytics_events"),
  aiReferrerLogs: db.collection("ai_referrer_logs"),
  recommendLogs: db.collection("recommend_logs"),
  allowedEmails: db.collection("allowed_emails"),
  esimRetryJobs: db.collection("esim_retry_jobs"),
  incidentLogs: db.collection("incident_logs"),
  userConsents: db.collection("user_consents"),
  exchangeRates: db.collection("exchange_rates"),
  promotions: db.collection("promotions"),
  systemStats: db.collection("system_stats"),
};

export { FieldValue };

// ─── Interfaces / Types（shared から再エクスポート・既存 import 互換）──────────

export type {
  FsUser,
  FsPlan,
  FsOrder,
  FsEsimLink,
  FsEsimActivation,
  FsStripeEvent,
  FsNotification,
  FsContactInquiry,
  FsAllowedEmail,
  FsEsimRetryJob,
  FsIncidentLog,
  FsUserConsent,
  FsExchangeRate,
  FsPromotion,
  FsSystemStats,
  FsEsimUsageLog,
  FsAnalyticsEvent,
} from "../../../shared/types";
