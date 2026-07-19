import * as logger from "firebase-functions/logger";
/**
 * callables/orders.ts — 注文/決済系 Callable（P3・callables.ts から無編集移動）
 *  - orderRetryPayment / ordersInitCheckout / ordersInitTopupCheckout
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireAuth, zodError } from "../_helpers";
import { collections, db, getEsimLinkByUuid, getOrderById, updateOrder, getUserByUid } from "../db";
import { createCheckoutSession, validateOrigin, getStripeClient } from "../stripe";
import { enforceRateLimit } from "../rateLimit";
import { assertProviderAvailable } from "../salesStopGuard";
import { stripeSecretKey, stripeWebhookSecret, omaxClientId, omaxClientSecret } from "../secrets";
import {
  OrderRetryPaymentInput,
  OrdersInitCheckoutInput,
  OrdersInitTopupCheckoutInput,
} from "../../../shared/schemas";

const REGION = "asia-northeast1";

// ─── orderRetryPayment ────────────────────────────────────────────────────────
// pending状態の注文に対して新しいStripe Checkoutセッションを発行し、
// checkoutUrlを返す。フロントエンドはそのURLに遷移して再決済を行う。

export const orderRetryPayment = onCall(
  {
    region: REGION,
    enforceAppCheck: true,
    timeoutSeconds: 120,
    secrets: [stripeSecretKey, stripeWebhookSecret],
  },
  async (request) => {
    const { uid } = await requireAuth(request);

    const parsed = OrderRetryPaymentInput.safeParse(request.data ?? {});
    if (!parsed.success) throw zodError(parsed.error.message);
    const { orderId, origin } = parsed.data;

    try {
      // 注文取得 & 所有者確認
      const order = await getOrderById(orderId, uid);
      if (!order) {
        throw new HttpsError("not-found", "注文が見つかりません。");
      }
      if (order.userId !== uid) {
        throw new HttpsError("permission-denied", "この注文へのアクセス権限がありません。");
      }
      if (order.status !== "pending") {
        throw new HttpsError("failed-precondition", `この注文は再決済できません（status: ${order.status}）。`);
      }

      // ユーザー情報取得
      const user = await getUserByUid(uid);
      const userEmail = user?.email ?? "";
      const userName = user?.name ?? "";

      // 既存のStripeセッションが本当に有効な場合のみ再利用する。
      // Checkout セッションは24時間で失効するため、無条件再利用だと古い pending 注文の
      // 「Complete Payment」が失効URLへ飛ばされ永久に決済できなかった
      if (order.checkoutUrl && order.stripeSessionId) {
        try {
          const session = await getStripeClient().checkout.sessions.retrieve(order.stripeSessionId);
          if (session.status === "open") {
            logger.info(`[orderRetryPayment] Reusing existing open checkout session for order: ${orderId}`);
            return { checkoutUrl: order.checkoutUrl };
          }
          logger.info(`[orderRetryPayment] Stored session ${order.stripeSessionId} is ${session.status}; creating a new one`);
        } catch (retrieveErr) {
          logger.warn(`[orderRetryPayment] Failed to retrieve session ${order.stripeSessionId}; creating a new one:`, retrieveErr);
        }
      }

      // 新しいStripe Checkoutセッションを作成
      const validatedOrigin = validateOrigin(origin);
      const { sessionId, checkoutUrl } = await createCheckoutSession({
        orderId,
        planId: order.planId,
        providerPlanId: order.providerPlanId,
        amountJpy: order.amountJpy,
        planName: order.planName ?? "Japan eSIM",
        userId: uid,
        userEmail,
        userName,
        stripeCustomerId: user?.stripeCustomerId ?? undefined,
        origin: validatedOrigin,
        ...(order.orderType === "topup" && order.esimLinkUuid
          ? { extraMetadata: { order_type: "topup", esim_link_uuid: order.esimLinkUuid } }
          : {}),
      });

      // Firestoreの注文にセッション情報を更新
      await updateOrder(orderId, { stripeSessionId: sessionId, checkoutUrl });

      logger.info(`[orderRetryPayment] New checkout session created for order: ${orderId}, url: ${checkoutUrl}`);
      return { checkoutUrl };
    } catch (e: any) {
      logger.error("[orderRetryPayment] Error:", e);
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", "内部サーバーエラーが発生しました。");
    }
  }
);

// ─── ordersInitCheckout ───────────────────────────────────────────────────────
// 購入フロー高速化: Firestoreトリガー（間接通信）の代わりに
// Callable Function（直接通信）で注文作成 + Stripe Checkout Session を一括生成。
// 所要時間: 3〜10秒+ → 1〜3秒 に短縮。

export const ordersInitCheckout = onCall(
  {
    region: REGION,
    enforceAppCheck: true,
    timeoutSeconds: 120,
    secrets: [stripeSecretKey, stripeWebhookSecret],
  },
  async (request) => {
    // 1. 認証チェック（ログイン必須 + メールホワイトリスト検証済み）
    const { uid, user } = await requireAuth(request);
    // クレカマスター/クラウド破産対策: UID単位で1時間10回まで
    await enforceRateLimit(`checkout:${uid}`, 10, 3600);
    const userEmail = user.email ?? "";
    const userName = user.name ?? "";

    // 2. 入力バリデーション
    const parsed = OrdersInitCheckoutInput.safeParse(request.data ?? {});
    if (!parsed.success) throw zodError(parsed.error.message);
    const { providerPlanId, origin, termsConsented, privacyConsented, marketingConsented, timezone, language, gaClientId } = parsed.data;

    // 3. プラン取得・検証（Firestoreから直接）
    const plansSnap = await db.collection("plans")
      .where("providerPlanId", "==", providerPlanId)
      .where("isActive", "==", true)
      .limit(1)
      .get();

    if (plansSnap.empty) {
      throw new HttpsError("not-found", "指定されたプランが見つかりません。");
    }
    const planDoc = plansSnap.docs[0];
    const plan = planDoc.data();

    // 3.5 販売停止ガード（柱2）：発行元プロバイダがダウン中なら課金前に弾く。
    await assertProviderAvailable(plan.provider ?? "bappy");

    // 4. Firestoreに注文レコードを作成（status: "pending"）
    const now = Date.now();
    const orderRef = await db.collection("orders").add({
      userId: uid,
      planId: planDoc.id,
      providerPlanId: plan.providerPlanId,
      // 柱2: プラン由来のプロバイダで発注を routing（未設定の既存Bappyプランは "bappy"）
      provider: plan.provider ?? "bappy",
      status: "pending",
      amountJpy: plan.priceJpy,
      planName: plan.name,
      hiddenByUser: false,
      orderType: "initial",
      origin,
      purchaseTimezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: language || null,
      termsConsented,
      privacyConsented,
      marketingConsented,
      gaClientId: gaClientId ?? null, // GA4 purchase をこの client_id で送りセッション縫合
      createdAt: now,
      updatedAt: now,
    });
    const orderId = orderRef.id;

    // 5. Stripe Checkout Session を作成
    try {
      const validatedOrigin = validateOrigin(origin);
      const { sessionId, checkoutUrl } = await createCheckoutSession({
        orderId,
        planId: planDoc.id,
        providerPlanId: plan.providerPlanId,
        amountJpy: plan.priceJpy,
        planName: plan.name,
        userId: uid,
        userEmail,
        userName,
        stripeCustomerId: user.stripeCustomerId ?? undefined,
        origin: validatedOrigin,
      });

      // 6. 注文にStripeセッション情報を書き込み
      await updateOrder(orderId, { stripeSessionId: sessionId, checkoutUrl });

      // 7. 同意記録の保存（APPI/GDPR対応）
      const ipAddress = request.rawRequest?.ip ?? undefined;
      const userAgent = request.rawRequest?.headers?.["user-agent"] ?? undefined;
      await collections.userConsents.add({
        userId: uid,
        consentType: "purchase",
        version: "2026-07-02",
        granted: true,
        termsGranted: termsConsented,
        privacyGranted: privacyConsented,
        marketingGranted: marketingConsented,
        ipAddress: ipAddress ?? null,
        userAgent: (Array.isArray(userAgent) ? userAgent[0] : userAgent) ?? null,
        consentedAt: now,
      });

      logger.info(`[ordersInitCheckout] Checkout session created for order: ${orderId}, url: ${checkoutUrl}`);
      return { checkoutUrl, orderId };
    } catch (err: any) {
      // Stripe失敗時は注文をcancelledに更新
      await updateOrder(orderId, { status: "cancelled" });
      logger.error(`[ordersInitCheckout] Failed for order: ${orderId}`, err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", "決済の初期化に失敗しました。");
    }
  }
);

// ─── ordersInitTopupCheckout ──────────────────────────────────────────────────
// トップアップ注文の作成とStripe Checkout Sessionの一括生成

export const ordersInitTopupCheckout = onCall(
  {
    region: REGION,
    enforceAppCheck: true,
    timeoutSeconds: 120,
    secrets: [stripeSecretKey, stripeWebhookSecret, omaxClientId, omaxClientSecret],
  },
  async (request) => {
    const { uid, user } = await requireAuth(request);
    // クレカマスター/クラウド破産対策: UID単位で1時間10回まで
    await enforceRateLimit(`topup:${uid}`, 10, 3600);
    const userEmail = user.email ?? "";
    const userName = user.name ?? "";

    const parsed = OrdersInitTopupCheckoutInput.safeParse(request.data ?? {});
    if (!parsed.success) throw zodError(parsed.error.message);
    const { esimLinkUuid, providerPlanId, origin, timezone, language } = parsed.data;

    // 所有権チェック（IDOR防止）: 対象のeSIMが本人のものであることを検証する。
    // これがないと他人のesimLinkUuidを指定して他ユーザーのeSIMにデータを追加できてしまう。
    const targetEsim = await getEsimLinkByUuid(esimLinkUuid);
    if (!targetEsim || targetEsim.userId !== uid) {
      throw new HttpsError("permission-denied", "この eSIM へのトップアップ権限がありません。");
    }

    // Firestore からプラン取得
    const planSnap = await collections.plans.where("providerPlanId", "==", providerPlanId).where("planType", "==", "topup").limit(1).get();
    if (planSnap.empty) {
      throw new HttpsError("not-found", "トップアッププランが見つかりません。");
    }

    const topupPlan = planSnap.docs[0].data();
    const planDocId = planSnap.docs[0].id;
    const amountJpy = topupPlan.priceJpy;
    const planName = topupPlan.name;

    // 販売停止ガード（柱2）：対象eSIMのプロバイダがダウン中なら課金前に弾く。
    await assertProviderAvailable(targetEsim.provider ?? topupPlan.provider ?? "bappy");

    // Firestoreに注文レコードを作成
    const now = Date.now();
    const orderRef = await db.collection("orders").add({
      userId: uid,
      planId: planDocId,
      providerPlanId: providerPlanId,
      esimLinkUuid,
      // 柱2: topup は対象eSIMのプロバイダに合わせる（無ければプラン→bappy の順でフォールバック）
      provider: targetEsim.provider ?? topupPlan.provider ?? "bappy",
      status: "pending",
      amountJpy,
      planName,
      hiddenByUser: false,
      orderType: "topup",
      origin,
      purchaseTimezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: language || null,
      createdAt: now,
      updatedAt: now,
    });
    const orderId = orderRef.id;

    // Stripe Checkout Session を作成
    try {
      const validatedOrigin = validateOrigin(origin);
      const { sessionId, checkoutUrl } = await createCheckoutSession({
        orderId,
        planId: planDocId,
        providerPlanId,
        amountJpy,
        planName,
        userId: uid,
        userEmail,
        userName,
        stripeCustomerId: user.stripeCustomerId ?? undefined,
        origin: validatedOrigin,
        extraMetadata: { order_type: "topup", esim_link_uuid: esimLinkUuid },
      });

      // 注文にStripeセッション情報を書き込み
      await updateOrder(orderId, { stripeSessionId: sessionId, checkoutUrl });

      logger.info(`[ordersInitTopupCheckout] Checkout session created for order: ${orderId}, url: ${checkoutUrl}`);
      return { checkoutUrl, orderId };
    } catch (err: any) {
      await updateOrder(orderId, { status: "cancelled" });
      logger.error(`[ordersInitTopupCheckout] Failed for order: ${orderId}`, err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", "決済の初期化に失敗しました。");
    }
  }
);
