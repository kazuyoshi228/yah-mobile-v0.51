/**
 * functions/src/db.ts — Firestore リポジトリ層のバレル（P2 で db/ に分割）
 *
 * 消費側は従来どおりこのファイルから import する（テストの vi.mock("./db") 互換維持）。
 * 実装はドメイン別に functions/src/db/ 配下：
 *   core（接続/collections/変換）・users・orders・esimLinks・retryJobs・
 *   incidents・notifications・inquiries・allowedEmails・analytics・infra
 */
export * from "./db/core";
export * from "./db/users";
export * from "./db/orders";
export * from "./db/esimLinks";
export * from "./db/retryJobs";
export * from "./db/incidents";
export * from "./db/notifications";
export * from "./db/inquiries";
export * from "./db/allowedEmails";
export * from "./db/analytics";
export * from "./db/infra";
