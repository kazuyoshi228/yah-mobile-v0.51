import { z } from "zod";

export const GetAiInsightsInput = z.object({
  period: z.enum(["24h", "7d", "30d", "90d"]).optional().default("7d"),
});

export const LogAiReferrerInput = z.object({
  botName: z.string().optional(),
  path: z.string().optional(),
  userAgent: z.string().optional(),
});

export const UpsertUserInput = z.object({
  name: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  loginMethod: z.string().optional().nullable(),
});

export const LogRecommendInput = z.object({
  planId: z.string().min(1),
  source: z.string().optional(),
  sessionId: z.string().optional(),
});

export const GetLogsInput = z.object({
  limit: z.number().int().min(1).max(500).optional().default(50),
});

export const GetRetryJobsInput = z.object({
  limit: z.number().int().min(1).max(500).optional().default(50),
});

export const OrderRetryPaymentInput = z.object({
  orderId: z.string().min(1),
  origin: z.string().url(),
});

export const SubmitContactInquiryInput = z.object({
  // Firebase Callable は undefined を null に変換して送るため、任意項目は null も許容する（.nullish()）
  name: z.string().max(100).nullish(),
  email: z.string().email().max(254),
  location: z.string().nullish(),
  category: z.string().nullish(),
  detail: z.string().nullish(),
  message: z.string().max(2000),
  orderId: z.string().nullish(),
  formStartTime: z.number(), // timestamp
  _hp: z.string().nullish(), // Honeypot
});

export const OrdersInitCheckoutInput = z.object({
  bappyPlanId: z.string().min(1),
  origin: z.string().url(),
  termsConsented: z.boolean(),
  privacyConsented: z.boolean(),
  marketingConsented: z.boolean(),
  timezone: z.string().max(100).nullish(),
});

export const OrdersInitTopupCheckoutInput = z.object({
  esimLinkUuid: z.string().min(1),
  bappyPlanId: z.string().min(1),
  origin: z.string().url(),
  timezone: z.string().max(100).nullish(),
});
