/**
 * callables/analytics.ts — 分析系 Callable（P3・callables.ts から無編集移動）
 */
import { onCall } from "firebase-functions/v2/https";
import { requireAdmin, zodError } from "../_helpers";
import { collections } from "../db";
import { invokeLLM } from "../llm";
import { enforceRateLimit } from "../rateLimit";
import { forgeApiKey } from "../secrets";
import { GetAiInsightsInput } from "../../../shared/schemas";

const REGION = "asia-northeast1";

// ─── Constants & Helpers ──────────────────────────────────────────────────────

const PERIOD_HOURS: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720, "90d": 2160 };

function periodSinceMs(period: string): number {
  const hours = PERIOD_HOURS[period] ?? 720;
  return Date.now() - hours * 60 * 60 * 1000;
}

interface AnalyticsEventDoc {
  id: string;
  eventName: string;
  sessionId?: string | null;
  userId?: string | null;
  page?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  language?: string | null;
  properties?: Record<string, unknown>;
  createdAt: number;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export const analyticsGetAiInsights = onCall({ region: REGION, enforceAppCheck: true, timeoutSeconds: 120, secrets: [forgeApiKey] }, async (request) => {
  const { uid } = await requireAdmin(request);
  // LLM課金の暴走防止: 管理者UID単位で1時間20回まで
  await enforceRateLimit(`aiinsights:${uid}`, 20, 3600);
  const parsed = GetAiInsightsInput.safeParse(request.data ?? {});
  if (!parsed.success) throw zodError(parsed.error.message);
  const period = parsed.data.period;
  const sinceMs = periodSinceMs(period);

  const [eventsSnap, aiLogsSnap, recLogsSnap] = await Promise.all([
    collections.analyticsEvents.where("createdAt", ">=", sinceMs).get(),
    collections.aiReferrerLogs.where("createdAt", ">=", sinceMs).get(),
    collections.recommendLogs.where("createdAt", ">=", sinceMs).get(),
  ]);
  const events: AnalyticsEventDoc[] = eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AnalyticsEventDoc));
  const aiLogs = aiLogsSnap.docs.map((d) => ({ botName: d.data().botName as string }));
  const recLogs = recLogsSnap.docs;

  const totalEvents = events.length;
  const pageViews = events.filter((e) => e.eventName === "page_view").length;
  const planSelects = events.filter((e) => e.eventName === "plan_select").length;
  const orders = events.filter((e) => e.eventName === "order_complete").length;
  const uniqueVisitors = new Set(events.map((e) => e.sessionId).filter(Boolean)).size;
  const cvr = uniqueVisitors > 0 ? ((orders / uniqueVisitors) * 100).toFixed(2) : "0.00";
  const aiBotVisits = aiLogs.length;
  const uniqueBots = new Set(aiLogs.map((l) => l.botName)).size;
  const recommendCalls = recLogs.length;

  const channelCounts: Record<string, number> = {};
  for (const ev of events.filter((e) => e.eventName === "page_view")) {
    const ref = ev.referrer ?? "";
    let ch = "Direct";
    if (/google\./i.test(ref)) ch = "Google";
    else if (/instagram/i.test(ref)) ch = "Instagram";
    else if (/t\.co|twitter|x\.com/i.test(ref)) ch = "Twitter/X";
    else if (/facebook|fb\.com/i.test(ref)) ch = "Facebook";
    else if (ref) ch = "Other";
    channelCounts[ch] = (channelCounts[ch] ?? 0) + 1;
  }
  const topChannel = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Direct";

  const summaryText = `
yah.mobile Analytics Summary (${period}):
- Total Events: ${totalEvents}
- Page Views: ${pageViews}
- Unique Visitors: ${uniqueVisitors}
- Plan Selects: ${planSelects}
- Orders: ${orders}
- CVR: ${cvr}%
- Top Traffic Channel: ${topChannel}
- AI Bot Visits: ${aiBotVisits} (${uniqueBots} unique bots)
- Recommend API Calls: ${recommendCalls}
`;

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "You are a data analyst for yah.mobile, a Japan eSIM service. Analyze the provided analytics data and give actionable insights in 3-5 bullet points. Focus on: conversion opportunities, traffic patterns, AI bot engagement, and specific recommendations. Be concise and specific. Respond in Japanese.",
      },
      { role: "user", content: summaryText },
    ],
  });
  // LLM 出力は長さ制限（異常に長い応答が Firestore 保存/UI に影響しないよう上限5000文字）
  const insight = (response.choices?.[0]?.message?.content ?? "インサイトを生成できませんでした。").slice(0, 5000);

  const last24hMs = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = events.filter((e) => e.createdAt > last24hMs).length;
  const dailyCounts: number[] = [];
  for (let i = 1; i <= 7; i++) {
    const dayStart = Date.now() - i * 24 * 60 * 60 * 1000;
    const dayEnd = Date.now() - (i - 1) * 24 * 60 * 60 * 1000;
    dailyCounts.push(events.filter((e) => e.createdAt >= dayStart && e.createdAt < dayEnd).length);
  }
  const mean = dailyCounts.reduce((a, b) => a + b, 0) / (dailyCounts.length || 1);
  const variance = dailyCounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (dailyCounts.length || 1);
  const stdDev = Math.sqrt(variance);
  const anomaly =
    stdDev > 0 && last24h > mean + 2 * stdDev
      ? {
          detected: true,
          message: `直近24hのイベント数(${last24h})が通常の2σを超えています（平均: ${mean.toFixed(1)}, σ: ${stdDev.toFixed(1)}）`,
        }
      : { detected: false, message: null };

  return { insight, anomaly, summaryText, generatedAt: new Date().toISOString() };
});
