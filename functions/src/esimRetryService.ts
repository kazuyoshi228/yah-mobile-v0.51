import * as logger from "firebase-functions/logger";
/**
 * eSIM Retry Service
 *
 * When eSIM provisioning fails (Bappy API error), this service:
 * 1. Creates a retry job in esim_retry_jobs
 * 2. Logs an incident in incident_logs
 * 3. Notifies Yoshi (owner) and optionally OMAX (when email is configured)
 * 4. Retries up to 3 times with 5-minute intervals
 * 5. On final failure, sends escalation notification
 */

import { createLink, addTopupPlan } from "./bappy";
import { notifyOwner } from "./adapters/notify";
import {
  sendEmail,
  buildEsimDelayedEmail,
  buildEsimFailedEmail,
  buildEsimReadyEmail,
} from "./mailer";
// Gmail MCP helper for OMAX/admin alerts (same pattern as scheduledHealthCheck.ts)
async function sendAlertEmail(to: string, subject: string, html: string): Promise<void> {
  await sendEmail({ to, subject, html });
}
import {
  updateOrder,
  createEsimLink,
  createEsimActivation,
  getEsimLinkByOrderId,
  createNotification,
  getUserById,
  createRetryJob,
  createIncidentLog,
  getPendingRetryJobs,
  updateRetryJob,
  resolveIncident,
  markIncidentNotified,
  collections,
} from "./db";
import { ENV } from "./env";

const OMAX_TECH_EMAIL = ENV.omaxTechEmail;

const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

export interface ProvisioningContext {
  orderId: string;
  userId: string;
  bappyPlanId: string;
  stripeSessionId: string;
  isTopup: boolean;
  parentOrderId?: string | null;
  esimLinkUuid?: string | null;
}

/**
 * Called from Stripe Webhook when eSIM provisioning fails.
 * Creates a retry job and incident log, then sends notifications.
 */
export async function handleProvisioningFailure(
  ctx: ProvisioningContext,
  error: unknown,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const now = Date.now();

  // 1. Create retry job (first attempt will be in 5 minutes)
  let retryJobId: string | null = null;
  try {
    retryJobId = await createRetryJob({
      orderId: ctx.orderId,
      userId: ctx.userId,
      bappyPlanId: ctx.bappyPlanId,
      stripeSessionId: ctx.stripeSessionId,
      isTopup: ctx.isTopup,
      parentOrderId: ctx.parentOrderId ?? null,
      esimLinkUuid: ctx.esimLinkUuid ?? null,
      maxRetries: MAX_RETRIES,
    });
  } catch (dbErr) {
    logger.error("[RetryService] Failed to create retry job:", dbErr);
  }

  // 2. Create incident log
  let incidentId: string | null = null;
  try {
    incidentId = await createIncidentLog({
      type: "esim_failure",
      severity: "critical",
      title: `eSIM発行失敗 — 注文 #${ctx.orderId}`,
      detail: `Order: ${ctx.orderId}\nUser: ${ctx.userId}\nBappy Plan: ${ctx.bappyPlanId}\nError: ${errorMessage}\nRetry job: ${retryJobId ?? "N/A"}`,
      orderId: ctx.orderId,
      userId: ctx.userId,
    });
  } catch (dbErr) {
    logger.error("[RetryService] Failed to create incident log:", dbErr);
  }

  // 3. Notify owner
  try {
    await notifyOwner({
      title: `🚨 eSIM発行失敗 — 注文 #${ctx.orderId}（自動リトライ中）`,
      content: `**注文ID:** ${ctx.orderId}\n**ユーザーID:** ${ctx.userId}\n**Bappyプラン:** ${ctx.bappyPlanId}\n**エラー:** ${errorMessage}\n\n自動リトライを最大${MAX_RETRIES}回（5分間隔）実行します。\n解決した場合は通知します。`,
    });
    if (incidentId) await markIncidentNotified(incidentId, "owner");
  } catch (notifyErr) {
    logger.error("[RetryService] Failed to notify owner:", notifyErr);
  }

  // 4. Notify OMAX if email is configured
  if (OMAX_TECH_EMAIL) {
    try {
      await sendAlertEmail(
        OMAX_TECH_EMAIL,
        `[yah.mobile] eSIM Provisioning Failure — Order #${ctx.orderId}`,
        `
          <h2>eSIM Provisioning Failure</h2>
          <table>
            <tr><td><b>Order ID</b></td><td>${ctx.orderId}</td></tr>
            <tr><td><b>User ID</b></td><td>${ctx.userId}</td></tr>
            <tr><td><b>Bappy Plan ID</b></td><td>${ctx.bappyPlanId}</td></tr>
            <tr><td><b>Is Topup</b></td><td>${ctx.isTopup}</td></tr>
            <tr><td><b>Error</b></td><td>${errorMessage}</td></tr>
            <tr><td><b>Time</b></td><td>${new Date(now).toISOString()}</td></tr>
          </table>
          <p>Automatic retry will be attempted up to ${MAX_RETRIES} times (every 5 minutes).</p>
        `,
      );
      if (incidentId) await markIncidentNotified(incidentId, "omax");
    } catch (mailErr) {
      logger.error("[RetryService] Failed to notify OMAX:", mailErr);
    }
  }

  // 5. Notify user in-app
  try {
    await createNotification({
      userId: ctx.userId,
      title: "eSIMの発行に遅延が発生しています",
      body: "eSIMの発行に時間がかかっています。自動的に再試行中です。通常15分以内に完了します。",
      // フロントは type で多言語翻訳する。遅延は最終失敗(order_failed)と区別する。
      type: "order_delayed",
      orderId: ctx.orderId,
    });
  } catch (notifyErr) {
    logger.error("[RetryService] Failed to create user notification:", notifyErr);
  }

  // 6. Send user email (retry-in-progress notification)
  try {
    const user = await getUserById(ctx.userId);
    if (user?.email) {
      const { subject, html } = buildEsimDelayedEmail({ orderId: ctx.orderId });
      await sendEmail({ to: user.email, subject, html });
      logger.info(`[RetryService] Sent retry-in-progress email to user ${ctx.userId}`);
    }
  } catch (mailErr) {
    logger.error("[RetryService] Failed to send retry-in-progress email to user:", mailErr);
  }
}

/**
 * Process pending retry jobs.
 * Called by the Heartbeat scheduler every 5 minutes.
 */
export async function processPendingRetries(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const jobs = await getPendingRetryJobs();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    processed++;
    const attemptNum = job.retryCount + 1;
    logger.info(`[RetryService] Processing retry job ${job.id} (attempt ${attemptNum}/${job.maxRetries}) for order ${job.orderId}`);

    try {
      await updateRetryJob(job.id, { status: "retrying", retryCount: attemptNum });

      if (job.isTopup) {
        // Topup retry
        if (!job.parentOrderId || !job.esimLinkUuid) {
          throw new Error("Missing parentOrderId or esimLinkUuid for topup retry");
        }
        const activation = await addTopupPlan({ identifier: job.esimLinkUuid, planId: job.bappyPlanId });
        const esimLink = await getEsimLinkByOrderId(job.parentOrderId);
        if (!esimLink) throw new Error("Parent eSIM link not found");
        // bappyPlanId はドキュメントIDではなくフィールドで検索（ID規約の二重化に依存しない）
        const planQuery = await collections.plans.where("bappyPlanId", "==", job.bappyPlanId).limit(1).get();
        const planData = planQuery.empty ? {} : planQuery.docs[0].data();
        
        await createEsimActivation({
          esimLinkId: esimLink.id,
          bappyActivationUuid: activation.uuid,
          bappyPlanId: job.bappyPlanId,
          activationType: "topup",
          expiryDate: activation.expiryDate ? new Date(activation.expiryDate).getTime() : null,
          dataRemainingMb: activation.dataRemainingMb,
          planName: planData?.name ?? null,
          totalDataGb: planData?.dataGb ?? null,
        });
      } else {
        // New eSIM retry
        const link = await createLink({ bappyPlanId: job.bappyPlanId, orderId: job.orderId });
        await createEsimLink({
          orderId: job.orderId,
          userId: job.userId,
          bappyLinkUuid: link.uuid,
          iccid: link.iccid,
          lpaProfile: link.lpaProfile,
          appleActivationUrl: link.appleActivationUrl,
          androidActivationUrl: link.androidActivationUrl,
        });
      }

      // Success
      await updateOrder(job.orderId, { status: "fulfilled" });
      await updateRetryJob(job.id, {
        status: "succeeded",
        resolvedAt: Date.now(),
      });
      succeeded++;

      // Notify owner of recovery (only if it took more than 1 retry)
      if (attemptNum > 1) {
        await notifyOwner({
          title: `✅ eSIM発行 自動回復 — 注文 #${job.orderId}（${attemptNum}回目で成功）`,
          content: `**注文ID:** ${job.orderId}\n**試行回数:** ${attemptNum}回目で成功\n\nユーザーへのeSIM配信が完了しました。`,
        });
      }

      // Notify user in-app
      await createNotification({
        userId: job.userId,
        title: "eSIMの発行が完了しました",
        body: "eSIMが正常に発行されました。マイページからご確認ください。",
        type: "order_fulfilled",
        orderId: job.orderId,
      });

      // Send user email (recovery success)
      try {
        const user = await getUserById(job.userId);
        if (user?.email) {
          const { subject, html } = buildEsimReadyEmail({ orderId: job.orderId });
          await sendEmail({ to: user.email, subject, html });
          logger.info(`[RetryService] Sent recovery-success email to user ${job.userId}`);
        }
      } catch (mailErr) {
        logger.error("[RetryService] Failed to send recovery-success email to user:", mailErr);
      }

      logger.info(`[RetryService] Retry job ${job.id} succeeded on attempt ${attemptNum}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      failed++;

      if (attemptNum >= job.maxRetries) {
        // Final failure — escalate
        await updateRetryJob(job.id, {
          status: "failed",
          lastError: errorMessage,
          resolvedAt: Date.now(),
        });
        await updateOrder(job.orderId, { status: "failed" });

        // Escalation notification to owner
        await notifyOwner({
          title: `🚨 eSIM発行 最終失敗 — 注文 #${job.orderId}（手動対応が必要）`,
          content: `**注文ID:** ${job.orderId}\n**試行回数:** ${attemptNum}回（全て失敗）\n**最後のエラー:** ${errorMessage}\n\n**手動対応が必要です。**\nStripeダッシュボードで返金処理、またはBappy APIを直接確認してください。`,
        });

        // Escalation email to OMAX
        if (OMAX_TECH_EMAIL) {
          try {
            await sendAlertEmail(
              OMAX_TECH_EMAIL,
              `[yah.mobile] ESCALATION: eSIM Provisioning Failed After ${MAX_RETRIES} Retries — Order #${job.orderId}`,
              `
                <h2 style="color:red">ESCALATION: Manual Intervention Required</h2>
                <p>eSIM provisioning for Order #${job.orderId} failed after ${MAX_RETRIES} automatic retries.</p>
                <table>
                  <tr><td><b>Order ID</b></td><td>${job.orderId}</td></tr>
                  <tr><td><b>Bappy Plan ID</b></td><td>${job.bappyPlanId}</td></tr>
                  <tr><td><b>Attempts</b></td><td>${attemptNum}</td></tr>
                  <tr><td><b>Last Error</b></td><td>${errorMessage}</td></tr>
                </table>
                <p>Please investigate the Bappy API and manually provision the eSIM or coordinate a refund.</p>
              `,
            );
          } catch (mailErr) {
            logger.error("[RetryService] Failed to send escalation email to OMAX:", mailErr);
          }
        }

        // Notify user of final failure (in-app)
        await createNotification({
          userId: job.userId,
          title: "eSIMの発行に失敗しました",
          body: "eSIMの発行に失敗しました。サポートにお問い合わせいただくか、返金をリクエストしてください。",
          type: "order_failed",
          orderId: job.orderId,
        });

        // Send user email (final failure)
        try {
          const user = await getUserById(job.userId);
          if (user?.email) {
            const { subject, html } = buildEsimFailedEmail({ orderId: job.orderId });
            await sendEmail({ to: user.email, subject, html });
            logger.info(`[RetryService] Sent final-failure email to user ${job.userId}`);
          }
        } catch (mailErr) {
          logger.error("[RetryService] Failed to send final-failure email to user:", mailErr);
        }

        logger.error(`[RetryService] Retry job ${job.id} FINAL FAILURE after ${attemptNum} attempts`);
      } else {
        // Schedule next retry
        const nextRetryAt = Date.now() + RETRY_INTERVAL_MS;
        await updateRetryJob(job.id, {
          status: "pending",
          retryCount: attemptNum,
          lastError: errorMessage,
          nextRetryAt,
        });
        logger.warn(`[RetryService] Retry job ${job.id} failed (attempt ${attemptNum}/${job.maxRetries}), next retry at ${new Date(nextRetryAt).toISOString()}`);
      }
    }
  }

  return { processed, succeeded, failed };
}

// Re-export resolveIncident for external use
export { resolveIncident };
