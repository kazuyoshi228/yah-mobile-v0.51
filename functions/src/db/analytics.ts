/**
 * db/analytics.ts — analytics_events / ai_referrer_logs / recommend_logs のリポジトリ
 * （P2・db.ts から無編集移動）
 */
import { collections } from "./core";
import type { FsAnalyticsEvent } from "./core";

export async function createAnalyticsEvent(
  data: Omit<FsAnalyticsEvent, "id" | "createdAt">,
): Promise<void> {
  await collections.analyticsEvents.add({ ...data, createdAt: Date.now() });
}

export async function createAiReferrerLog(data: {
  botName: string;
  path: string;
  userAgent?: string | null;
  ipHash?: string | null;
}): Promise<void> {
  await collections.aiReferrerLogs.add({ ...data, createdAt: Date.now() });
}

export async function createRecommendLog(data: {
  usage?: string | null;
  purpose?: string | null;
  recommendedPlanId?: string | null;
  sessionId?: string | null;
}): Promise<string> {
  const ref = await collections.recommendLogs.add({
    ...data,
    actualPlanId: null,
    matched: "pending",
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function updateRecommendLog(id: string, data: { actualPlanId?: string; matched?: "true" | "false" | "pending" }): Promise<void> {
  await collections.recommendLogs.doc(id).update(data);
}
