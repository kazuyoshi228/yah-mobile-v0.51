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

import { getProvider } from "./providers/types";
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
  getEsimLinkByUuid,
  createNotification,
  getUserById,
  getOrderById,
  createRetryJob,
  createIncidentLog,
  getPendingEsimRetryJobs,
  updateRetryJob,
  resolveIncident,
  markIncidentNotified,
  collections,
} from "./db";
import { ENV } from "./env";
import { executeRefund, isAutoRefundEnabled } from "./refund";

const OMAX_TECH_EMAIL = ENV.omaxTechEmail;

const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

export interface ProvisioningContext {
  orderId: string;
  userId: string;
  providerPlanId: string;
  provider?: "esimaccess" | "bappy" | null;
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
      providerPlanId: ctx.providerPlanId,
      provider: ctx.provider ?? "bappy",
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
      detail: `Order: ${ctx.orderId}\nUser: ${ctx.userId}\nBappy Plan: ${ctx.providerPlanId}\nError: ${errorMessage}\nRetry job: ${retryJobId ?? "N/A"}`,
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
      content: `**注文ID:** ${ctx.orderId}\n**ユーザーID:** ${ctx.userId}\n**Bappyプラン:** ${ctx.providerPlanId}\n**エラー:** ${errorMessage}\n\n自動リトライを最大${MAX_RETRIES}回（5分間隔）実行します。\n解決した場合は通知します。`,
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
            <tr><td><b>Bappy Plan ID</b></td><td>${ctx.providerPlanId}</td></tr>
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
      const order = await getOrderById(ctx.orderId);
      const { subject, html } = buildEsimDelayedEmail({ orderId: ctx.orderId, language: order?.language });
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
  const jobs = await getPendingEsimRetryJobs();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    processed++;
    const attemptNum = job.retryCount + 1;
    logger.info(`[RetryService] Processing retry job ${job.id} (attempt ${attemptNum}/${job.maxRetries}) for order ${job.orderId}`);

    // 返金/取消済み・履行済みの注文には絶対に再発行しない（返金との競合・二重発行ガード）
    const currentOrder = await getOrderById(job.orderId);
    const orderStatus = currentOrder?.status ?? "missing";
    const refundStatus = (currentOrder as { refundStatus?: string } | null)?.refundStatus;
    if (!currentOrder || ["refunded", "cancelled", "fulfilled"].includes(orderStatus)
      || refundStatus === "processing" || refundStatus === "refunded") {
      logger.warn(`[RetryService] Skipping job ${job.id}: order ${job.orderId} status=${orderStatus} refund=${refundStatus ?? "-"}`);
      await updateRetryJob(job.id, {
        status: "cancelled",
        resolvedAt: Date.now(),
        lastError: `retry aborted: order status=${orderStatus} refundStatus=${refundStatus ?? "-"}`,
      });
      continue;
    }

    try {
      await updateRetryJob(job.id, { status: "retrying", retryCount: attemptNum });

      let installBy: number | null = null; // 新規発行時のインストール期限（発行完了メールに記載）
      if (job.isTopup) {
        // Topup retry — 親eSIMは providerRef(=esimLinkUuid=esim_linksのdocID) で直接解決する。
        if (!job.esimLinkUuid) {
          throw new Error("Missing esimLinkUuid for topup retry");
        }
        const activation = await getProvider(job.provider).topup({ providerRef: job.esimLinkUuid, providerPlanId: job.providerPlanId, transactionId: job.orderId });
        const esimLink = await getEsimLinkByUuid(job.esimLinkUuid);
        if (!esimLink) throw new Error("Parent eSIM link not found");
        // providerPlanId はドキュメントIDではなくフィールドで検索（ID規約の二重化に依存しない）
        const planQuery = await collections.plans.where("providerPlanId", "==", job.providerPlanId).limit(1).get();
        const planData = planQuery.empty ? {} : planQuery.docs[0].data();

        await createEsimActivation({
          esimLinkId: esimLink.id,
          bappyActivationUuid: activation.providerRef,
          providerPlanId: job.providerPlanId,
          activationType: "topup",
          expiryDate: activation.expiryDate, // provider が epoch ms に正規化済み
          dataRemainingMb: activation.dataRemainingMb,
          planName: planData?.name ?? null,
          totalDataGb: planData?.dataGb ?? null,
        });
      } else {
        // New eSIM retry
        const detail = await getProvider(job.provider).createEsim({ providerPlanId: job.providerPlanId, orderId: job.orderId, transactionId: job.orderId });
        installBy = detail.expiryDate; // インストール期限（発行完了メールに記載）
        // 本流（webhooks.fulfillEsim）と同一フィールドで作成する。
        // 旧実装は status:"provisioning" のまま QR/期限/残量/プラン名が欠落し、
        // リトライで回復した顧客のマイページ表示が不完全だった
        const planQuery = await collections.plans.where("providerPlanId", "==", job.providerPlanId).limit(1).get();
        const planDoc = planQuery.empty ? null : planQuery.docs[0];
        const planData = (planDoc?.data() ?? {}) as { name?: string; dataGb?: number };
        await createEsimLink({
          orderId: job.orderId,
          userId: job.userId,
          provider: job.provider ?? "bappy",
          providerRef: detail.providerRef,
          bappyLinkUuid: detail.providerRef,
          iccid: detail.iccid ?? "",
          lpaProfile: detail.lpaProfile ?? "",
          appleActivationUrl: detail.appleActivationUrl,
          androidActivationUrl: detail.androidActivationUrl,
          qrCodeUrl: detail.qrCodeUrl ?? null,
          dataRemainingMb: detail.dataRemainingMb ?? null,
          dataTotalMb: detail.dataTotalMb ?? null,
          expiryDate: detail.expiryDate ?? null,
          status: "active",
          planId: planDoc?.id ?? null,
          planName: planData.name ?? null,
          totalDataGb: planData.dataGb ?? null,
        } as Parameters<typeof createEsimLink>[0]);
      }

      // Success
      await updateOrder(job.orderId, { status: "fulfilled" });
      await updateRetryJob(job.id, {
        status: "succeeded",
        resolvedAt: Date.now(),
      });
      succeeded++;

      // 通知系の副作用は個別に握りつぶす。
      // ここで例外を外側 catch に到達させると「発行成功」が「最終失敗→自動返金」に転化する
      // （発行済みなのに返金される最悪パターン）ため、成功確定後の失敗は記録のみとする。
      try {
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
      } catch (sideErr) {
        logger.error("[RetryService] post-success notification failed (ignored):", sideErr);
      }

      // Send user email (recovery success)
      try {
        const user = await getUserById(job.userId);
        if (user?.email) {
          const order = await getOrderById(job.orderId);
          const { subject, html } = buildEsimReadyEmail({ orderId: job.orderId, language: order?.language, installBy });
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

        // Lane A: 当社側エラー（発行/topup 最終失敗）は自動で全額返金する。
        // 返金の確定・顧客通知・返金メールは charge.refunded webhook 側で一元処理される。
        // キルスイッチ（system_config/refunds.autoRefundEnabled）で即時停止できる。
        let autoRefundTriggered = false;
        try {
          if (await isAutoRefundEnabled()) {
            const rr = await executeRefund(job.orderId, "system_failure");
            autoRefundTriggered = rr.ok;
            if (rr.ok) {
              logger.info(`[RetryService] Auto-refund triggered for order ${job.orderId}`);
              await notifyOwner({
                title: `↩️ 自動返金を実行 — 注文 #${job.orderId}`,
                content: `発行/topup 最終失敗のため自動返金をトリガーしました。確定・顧客への返金メールは charge.refunded webhook で処理されます。`,
              }).catch(() => undefined);
            } else if (rr.error !== "no_payment_intent") {
              // executeRefund 内で incident_logs 記録＋オーナー通知済み。
              logger.error(`[RetryService] Auto-refund failed for order ${job.orderId}: ${rr.error}`);
            }
          } else {
            logger.warn(`[RetryService] Auto-refund disabled (kill switch) for order ${job.orderId}`);
            await notifyOwner({
              title: `⏸️ 自動返金OFF・手動対応要 — 注文 #${job.orderId}`,
              content: `自動返金がキルスイッチ（/admin 返金タブのトグル）で無効化されています。/admin 返金タブから手動で返金してください。`,
            }).catch(() => undefined);
          }
        } catch (refundErr) {
          logger.error(`[RetryService] Auto-refund unexpected error for order ${job.orderId}:`, refundErr);
        }

        // Escalation notification to owner（技術的失敗の調査喚起）
        await notifyOwner({
          title: `🚨 eSIM発行 最終失敗 — 注文 #${job.orderId}`,
          content: `**注文ID:** ${job.orderId}\n**試行回数:** ${attemptNum}回（全て失敗）\n**最後のエラー:** ${errorMessage}\n\n**返金:** ${autoRefundTriggered ? "自動でトリガー済み（webhookで確定）" : "未実行 — /admin 返金タブで手動対応してください"}。\nBappy API 側の原因調査もお願いします。`,
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
                  <tr><td><b>Bappy Plan ID</b></td><td>${job.providerPlanId}</td></tr>
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

        // 顧客への通知/メール：自動返金をトリガーした場合は送らない。
        // （charge.refunded webhook が refund_completed 通知＋返金メールを送るため、
        //   ここで「返金をリクエストしてください」と案内すると矛盾・二重連絡になる。）
        if (!autoRefundTriggered) {
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
              const order = await getOrderById(job.orderId);
              const { subject, html } = buildEsimFailedEmail({ orderId: job.orderId, language: order?.language });
              await sendEmail({ to: user.email, subject, html });
              logger.info(`[RetryService] Sent final-failure email to user ${job.userId}`);
            }
          } catch (mailErr) {
            logger.error("[RetryService] Failed to send final-failure email to user:", mailErr);
          }
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
