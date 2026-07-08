/**
 * db/retryJobs.ts — esim_retry_jobs のリポジトリ（P2・db.ts から無編集移動）
 */
import { collections, docToObj, queryToArr } from "./core";
import type { FsEsimRetryJob } from "./core";

export async function createEsimRetryJob(data: Omit<FsEsimRetryJob, "id" | "createdAt" | "updatedAt">): Promise<FsEsimRetryJob> {
  const now = Date.now();
  const expiresAt = data.expiresAt ?? (now + 30 * 24 * 60 * 60 * 1000); // 30 days
  const ref = await collections.esimRetryJobs.add({ ...data, expiresAt, createdAt: now, updatedAt: now });
  const snap = await ref.get();
  return docToObj<FsEsimRetryJob>(snap)!;
}

export async function getPendingEsimRetryJobs(): Promise<FsEsimRetryJob[]> {
  const snap = await collections.esimRetryJobs
    .where("status", "in", ["pending", "retrying"])
    .get();
  return queryToArr<FsEsimRetryJob>(snap);
}

export async function updateEsimRetryJob(id: string, data: Partial<FsEsimRetryJob>): Promise<void> {
  await collections.esimRetryJobs.doc(id).update({ ...data, updatedAt: Date.now() });
}

export async function createRetryJob(data: {
  orderId: string;
  userId: string;
  bappyPlanId: string;
  provider?: "esimaccess" | "bappy" | null;
  stripeSessionId: string;
  isTopup: boolean;
  parentOrderId?: string | null;
  esimLinkUuid?: string | null;
  maxRetries?: number;
}): Promise<string> {
  const job = await createEsimRetryJob({
    ...data,
    retryCount: 0,
    maxRetries: data.maxRetries ?? 5,
    status: "pending",
    lastError: null,
    nextRetryAt: null,
    resolvedAt: null,
  });
  return job.id;
}

// P1-2: 単なるエイリアス getPendingRetryJobs / 未使用 getRetryJobs は削除（getPendingEsimRetryJobs に統一）

export async function updateRetryJob(
  id: string,
  data: Partial<Pick<FsEsimRetryJob, "status" | "retryCount" | "lastError" | "nextRetryAt" | "resolvedAt" | "parentOrderId">>,
): Promise<void> {
  await updateEsimRetryJob(id, data);
}
