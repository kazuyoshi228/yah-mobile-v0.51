/**
 * functions/src/index.ts — Firebase Cloud Functions entry point (Consolidated Flat Structure)
 */
import { initializeApp } from "firebase-admin/app";

// Initialize Firebase Admin SDK first
initializeApp();

// Export all consolidated triggers, APIs, webhooks and cron jobs
export * from "./triggers";
export * from "./webhooks";
export * from "./webhooks_bappy";
export * from "./scheduled";
export * from "./analytics";
export * from "./clientErrors";
export * from "./llmsTxt";
export * from "./currencyRates";
export * from "./callables";
