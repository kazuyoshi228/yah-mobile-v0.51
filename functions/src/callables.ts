/**
 * functions/src/callables.ts — HTTPS Callable Functions のバレル（P3 で callables/ に分割）
 *
 * Cloud Functions のエクスポート名（=デプロイされる関数名）は分割前と完全に同一。
 * 消費側・テストは従来どおりこのファイルから import する。
 * 実装はドメイン別に functions/src/callables/ 配下：
 *   orders（orderRetryPayment / ordersInitCheckout / ordersInitTopupCheckout）
 *   refunds（adminRefundOrder）・contact（submitContactInquiry）・analytics（analyticsGetAiInsights）
 */
export * from "./callables/analytics";
export * from "./callables/orders";
export * from "./callables/contact";
export * from "./callables/refunds";
