import * as logger from "firebase-functions/logger";
/**
 * functions/src/webhooks.ts — Unified external server callbacks / Stripe Webhook handlers
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { constructWebhookEvent } from "./stripe";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const omaxClientId = defineSecret("OMAX_CLIENT_ID");
const omaxClientSecret = defineSecret("OMAX_CLIENT_SECRET");
const gmailUser = defineSecret("GMAIL_USER");
const gmailPass = defineSecret("GMAIL_PASS");
// 発券失敗時のオーナー通知（Forge/Slack）で使用
const forgeApiKey = defineSecret("BUILT_IN_FORGE_API_KEY");
const slackWebhookUrl = defineSecret("SLACK_WEBHOOK_URL");
// オーナー通知のメール到達フォールバック（S9）で使用
const ownerEmail = defineSecret("OWNER_EMAIL");

import {
  getOrderByStripeSessionId,
  getOrderByStripePaymentIntentId,
  updateOrder,
  getEsimLinkByOrderId,
  getUserByUid,
  getUserById,
  createNotification,
  collections,
  db,
  FsOrder,
  FsUser,
  incrementSystemStats,
} from "./db";
import { getProvider } from "./providers/types";
import { sendEmail, buildEsimReadyEmail, buildPurchaseReceivedEmail, buildRefundCompletedEmail } from "./mailer";
import { handleProvisioningFailure } from "./esimRetryService";
export const stripeWebhook = onRequest(
  {
    region: "asia-northeast1",
    timeoutSeconds: 120,
    secrets: [stripeSecretKey, stripeWebhookSecret, omaxClientId, omaxClientSecret, gmailUser, gmailPass, forgeApiKey, slackWebhookUrl, ownerEmail],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let event: any;
    try {
      event = constructWebhookEvent(req.rawBody as any, sig);
    } catch (err) {
      logger.error("[stripeWebhook] Signature verification failed:", err);
      res.status(400).send("Webhook signature verification failed");
      return;
    }

    if ((event as { id: string }).id.startsWith("evt_test_")) {
      logger.info("[stripeWebhook] Test event detected");
      res.json({ verified: true });
      return;
    }

    const ev = event as { type: string; id: string; data: { object: Record<string, unknown> } };
    logger.info(`[stripeWebhook] Event: ${ev.type} (${ev.id})`);

    // Idempotency: atomically claim the event within a transaction so concurrent
    // deliveries serialize on the event document. Already-completed events are
    // skipped; a previously-failed event (processed:false) is left claimable so
    // Stripe's retries can still recover it.
    const eventRef = collections.stripeEvents.doc(ev.id);
    let alreadyProcessed = false;
    await db.runTransaction(async (t) => {
      const snap = await t.get(eventRef);
      if (snap.exists && snap.data()?.processed === true) {
        alreadyProcessed = true;
        return;
      }
      t.set(
        eventRef,
        {
          stripeEventId: ev.id,
          eventType: ev.type,
          processed: false,
          createdAt: snap.data()?.createdAt ?? Date.now(),
        },
        { merge: true },
      );
    });

    if (alreadyProcessed) {
      logger.info(`[stripeWebhook] Event ${ev.id} already processed successfully. Skipping.`);
      res.json({ received: true, skipped: true });
      return;
    }

    try {
      if (ev.type === "checkout.session.completed") {
        await handleCheckoutCompleted(ev.data.object);
      } else if (ev.type === "charge.refunded") {
        await handleChargeRefunded(ev.data.object);
      }
      // Update as processed successfully
      await eventRef.update({ processed: true });
    } catch (err) {
      logger.error(`[stripeWebhook] Error processing event ${ev.type}:`, err);
      // We don't mark as processed so it can be retried by Stripe
      res.status(500).send("Internal server error");
      return;
    }

    res.json({ received: true });
  }
);

/**
 * charge.refunded ハンドラ（返金の真実源）。
 * 返金の入口（/admin返金ボタン=adminRefundOrder / Lane A自動 / Stripeダッシュボード手動）が
 * どれであっても、Stripe が返金を実行すると本イベントが届く。ここで初めて注文を "refunded" に
 * 確定し、顧客への通知＋返金メールを一元的に送る（＝全経路で反映・通知が一貫する）。
 * 冪等：既に refunded の注文は何もしない（webhook 冪等ガード＋本チェックの二重防御）。
 */
async function handleChargeRefunded(charge: Record<string, unknown>) {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!paymentIntentId) {
    logger.error("[handleChargeRefunded] No payment_intent on charge; cannot locate order");
    return;
  }

  const order = await getOrderByStripePaymentIntentId(paymentIntentId);
  if (!order) {
    logger.error(`[handleChargeRefunded] Order not found for payment_intent: ${paymentIntentId}`);
    return;
  }

  if (order.status === "refunded" || order.refundStatus === "refunded") {
    logger.info(`[handleChargeRefunded] Order ${order.id} already refunded. Skipping.`);
    return;
  }

  const refunds = charge.refunds as { data?: Array<{ id?: string }> } | undefined;
  const stripeRefundId = refunds?.data?.[0]?.id ?? null;
  const now = Date.now();

  await updateOrder(order.id!, {
    status: "refunded",
    refundStatus: "refunded",
    stripeRefundId,
    refundedAt: now,
  });

  // 顧客への in-app 通知（本文は client 側で i18n。ここでは英語フォールバックを保存）
  await createNotification({
    userId: order.userId,
    title: "Refund processed",
    body: `Your payment for order #${order.id} has been refunded in full.`,
    type: "refund_completed",
    orderId: order.id!,
  }).catch((err: unknown) => logger.error(`[handleChargeRefunded] Failed to create notification for order ${order.id}:`, err));

  // 返金完了メール（購入時ページ言語で5言語分岐）
  const email = order.userEmail ?? (await getUserById(order.userId).catch(() => null))?.email ?? null;
  if (email) {
    const built = buildRefundCompletedEmail({ orderId: order.id!, amountJpy: order.amountJpy, language: order.language });
    await sendEmail({ to: email, ...built }).catch((err: unknown) =>
      logger.error(`[handleChargeRefunded] Failed to send refund email for order ${order.id}:`, err),
    );
  }

  logger.info(`[handleChargeRefunded] Order ${order.id} marked refunded (refundId=${stripeRefundId ?? "n/a"})`);
}

async function handleCheckoutCompleted(session: Record<string, unknown>) {
  const orderId = (session.metadata as Record<string, string> | undefined)?.order_id;
  if (!orderId) {
    logger.error("[handleCheckoutCompleted] No order_id in metadata");
    return;
  }

  const stripeSessionId = session.id as string;
  const order = await getOrderByStripeSessionId(stripeSessionId);
  if (!order) {
    logger.error(`[handleCheckoutCompleted] Order not found for session: ${stripeSessionId}`);
    return;
  }

  if (order.status === "fulfilled") {
    logger.info(`[handleCheckoutCompleted] Order ${order.id} already fulfilled`);
    return;
  }

  // 割引前の小計（amount_subtotal）で検証する。allow_promotion_codes による正当な
  // クーポン利用では amount_total が割引後の額になるため、amount_total の完全一致で
  // 検証すると発券が「金額不一致」で失敗し pending_retry ループに陥る。unit_amount は
  // サーバー側で order.amountJpy として設定しているため、subtotal 検証で価格改ざんも防げる。
  const amountTotal = session.amount_total as number;
  const amountSubtotal = (session.amount_subtotal as number) ?? amountTotal;
  if (amountSubtotal !== order.amountJpy) {
    logger.error(`[handleCheckoutCompleted] Amount mismatch for order ${order.id}. Expected subtotal ${order.amountJpy}, got ${amountSubtotal} (total ${amountTotal}).`);
    throw new Error(`Amount mismatch: checkout subtotal (${amountSubtotal}) does not match order amount (${order.amountJpy}).`);
  }

  const paymentIntent = session.payment_intent;
  const customerId = session.customer as string | undefined;

  // Extract customer details for denormalization
  const customerDetails = session.customer_details as any;
  const userEmail = customerDetails?.email ?? null;
  const userName = customerDetails?.name ?? null;
  const purchaseCountry = customerDetails?.address?.country ?? null;
  const purchaseCity = customerDetails?.address?.city ?? null;

  // Calculate discount percentage if possible
  let discountPercentage: number | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalDetails = session.total_details as any;
  const amountDiscount = totalDetails?.amount_discount ?? 0;
  if (amountDiscount > 0 && amountSubtotal > 0) {
    discountPercentage = Math.round((amountDiscount / amountSubtotal) * 100);
  }

  await updateOrder(order.id!, {
    status: "paid",
    stripePaymentIntentId: typeof paymentIntent === "string" ? paymentIntent : null,
    userEmail,
    userName,
    purchaseCountry,
    purchaseCity,
    discountPercentage,
  });

  // Increment system stats (Aggregation for BaaS Dashboards)
  await incrementSystemStats(order.amountJpy).catch(e => logger.error("Failed to increment system stats", e));

  if (customerId && typeof customerId === "string") {
    // 顧客IDをユーザープロフィールに保存
    await collections.users.doc(order.userId).update({ stripeCustomerId: customerId }).catch(e => logger.error("Failed to update stripeCustomerId", e));
  }

  logger.info(`[handleCheckoutCompleted] Order ${order.id} marked as paid, starting eSIM fulfillment`);

  // 購入受付メール（発行前・即時）。失敗しても発行処理は継続する。
  if (userEmail) {
    const receivedEmail = buildPurchaseReceivedEmail({ orderId: order.id! });
    await sendEmail({ to: userEmail, ...receivedEmail }).catch((err: unknown) =>
      logger.error(`[handleCheckoutCompleted] Failed to send purchase-received email for order ${order.id}:`, err),
    );
  }

  await fulfillEsim(order);
}

async function fulfillEsim(orderData: FsOrder) {
  const orderId = orderData.id;
  const userId = orderData.userId;
  const bappyPlanId = orderData.bappyPlanId;
  const isTopup = orderData.orderType === "topup";

  const existingEsim = await getEsimLinkByOrderId(orderId);
  if (existingEsim) {
    logger.info(`[fulfillEsim] eSIM already exists for order: ${orderId}`);
    await updateOrder(orderId, { status: "fulfilled" });
    return;
  }

  try {
    const provider = orderData.provider;
    let linkUuid = "";
    if (isTopup) {
      const parentLinkUuid = orderData.esimLinkUuid;
      if (!parentLinkUuid) throw new Error("Topup order missing esimLinkUuid");
      await getProvider(provider).topup({ providerRef: parentLinkUuid, providerPlanId: bappyPlanId, transactionId: orderId });
      linkUuid = parentLinkUuid;
      logger.info(`[fulfillEsim] Topup successful for link: ${linkUuid}`);
    } else {
      const detail = await getProvider(provider).createEsim({ providerPlanId: bappyPlanId, orderId, transactionId: orderId });
      linkUuid = detail.providerRef;

      // プランは管理画面から自動IDで作成されるため、ドキュメントIDではなく
      // bappyPlanId フィールドで検索する（ID規約の二重化に依存しない）。
      const planQuery = await collections.plans.where("bappyPlanId", "==", bappyPlanId).limit(1).get();
      const planDoc = planQuery.empty ? null : planQuery.docs[0];
      const planData = planDoc?.data() ?? {};

      await collections.esimLinks.doc(detail.providerRef).set({
        orderId,
        userId,
        provider: provider ?? "bappy",
        providerRef: detail.providerRef,
        bappyLinkUuid: detail.providerRef, // 後方互換（既存の同期/参照が bappyLinkUuid を使う）
        iccid: detail.iccid,
        lpaProfile: detail.lpaProfile,
        appleActivationUrl: detail.appleActivationUrl ?? null,
        androidActivationUrl: detail.androidActivationUrl ?? null,
        qrCodeUrl: detail.qrCodeUrl ?? null,
        dataRemainingMb: detail.dataRemainingMb ?? null,
        dataTotalMb: detail.dataTotalMb ?? null,
        expiryDate: detail.expiryDate, // provider が epoch ms に正規化済み
        status: "active",
        planId: planDoc?.id ?? null,
        planName: planData?.name ?? null,
        totalDataGb: planData?.dataGb ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    await updateOrder(orderId, { status: "fulfilled", esimLinkUuid: linkUuid });

    // Update user metrics
    const userRef = collections.users.doc(userId);
    await db.runTransaction(async (t) => {
      const uSnap = await t.get(userRef);
      if (!uSnap.exists) return;
      const uData = uSnap.data() as FsUser;
      const currentMetrics = uData.metrics || { ltvJpy: 0, orderCount: 0 };
      t.update(userRef, {
        metrics: {
          ltvJpy: (currentMetrics.ltvJpy || 0) + orderData.amountJpy,
          orderCount: (currentMetrics.orderCount || 0) + 1,
          lastPurchaseDate: Date.now()
        }
      });
    });

    const user = await getUserByUid(userId);
    if (user?.email) {
      const emailContent = buildEsimReadyEmail({ orderId });
      await sendEmail({ to: user.email, ...emailContent }).catch((err: unknown) =>
        logger.error("[fulfillEsim] Email error:", err)
      );
    }

    logger.info(`[fulfillEsim] eSIM fulfilled for order: ${orderId}`);
  } catch (err) {
    logger.error(`[fulfillEsim] eSIM fulfillment failed for order ${orderId}:`, err);
    await updateOrder(orderId, { status: "pending_retry" });
    
    await handleProvisioningFailure(
      {
        orderId,
        userId,
        bappyPlanId,
        stripeSessionId: orderData.stripeSessionId ?? "",
        isTopup,
        parentOrderId: isTopup ? orderData.esimLinkUuid : undefined,
        esimLinkUuid: isTopup ? undefined : undefined,
      },
      err
    );
  }
}
