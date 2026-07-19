import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---
vi.mock("firebase-functions/v2/https", () => ({
  // Make onRequest return the handler directly so we can call it
  onRequest: vi.fn((opts, handler) => handler)
}));
vi.mock("firebase-functions/params", () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn() }))
}));

const mockConstructWebhookEvent = vi.fn();
vi.mock("./stripe", () => ({
  constructWebhookEvent: (...args: any[]) => mockConstructWebhookEvent(...args)
}));

const mockGetOrderByStripeSessionId = vi.fn();
const mockGetOrderByPaymentIntentId = vi.fn();
const mockGetOrderById = vi.fn();
const mockNotifyOwner = vi.fn().mockResolvedValue(undefined);
const mockUpdateOrder = vi.fn();
const mockEventRefGet = vi.fn();
const mockEventRefSet = vi.fn();
const mockEventRefUpdate = vi.fn();

vi.mock("./db", () => {
  return {
    getOrderByStripeSessionId: (...args: any[]) => mockGetOrderByStripeSessionId(...args),
    getOrderByStripePaymentIntentId: (...args: any[]) => mockGetOrderByPaymentIntentId(...args),
    getOrderById: (...args: any[]) => mockGetOrderById(...args),
    updateOrder: (...args: any[]) => mockUpdateOrder(...args),
    getEsimLinkByOrderId: vi.fn().mockResolvedValue(null),
    updateEsimLink: vi.fn(),
    getUserByUid: vi.fn().mockResolvedValue(null),
    getUserById: vi.fn().mockResolvedValue(null),
    createNotification: vi.fn().mockResolvedValue(undefined),
    createEsimActivation: vi.fn().mockResolvedValue({ id: "act1", bappyActivationUuid: "x" }),
    getEsimActivationByOrderId: vi.fn().mockResolvedValue(null),
    incrementSystemStats: vi.fn().mockResolvedValue(undefined),
    // Idempotency now uses db.runTransaction; the txn get/set delegate to the same mocks.
    db: {
      runTransaction: async (fn: any) =>
        fn({
          get: (...args: any[]) => mockEventRefGet(...args),
          set: (_ref: any, data: any) => mockEventRefSet(data),
        }),
    },
    collections: {
      stripeEvents: {
        doc: vi.fn(() => ({
          get: mockEventRefGet,
          set: mockEventRefSet,
          update: mockEventRefUpdate
        }))
      }
    }
  };
});

vi.mock("./bappy", () => ({ createLink: vi.fn(), addTopupPlan: vi.fn() }));
vi.mock("./adapters/notify", () => ({ notifyOwner: (...a: any[]) => mockNotifyOwner(...a) }));
vi.mock("./mailer", () => ({
  sendEmail: vi.fn(),
  buildEsimReadyEmail: vi.fn(() => ({ subject: "", html: "" })),
  buildPurchaseReceivedEmail: vi.fn(() => ({ subject: "", html: "" })),
  buildRefundCompletedEmail: vi.fn(() => ({ subject: "", html: "" })),
}));
const mockHandleProvisioningFailure = vi.fn();
vi.mock("./esimRetryService", () => ({ handleProvisioningFailure: (...a: any[]) => mockHandleProvisioningFailure(...a) }));
// 発行/トップアップのプロバイダ呼び出しをモック（topup を失敗させてリトライ登録を検証する）
const mockProviderTopup = vi.fn();
const mockProviderCreateEsim = vi.fn();
vi.mock("./providers/types", () => ({
  getProvider: () => ({ topup: (...a: any[]) => mockProviderTopup(...a), createEsim: (...a: any[]) => mockProviderCreateEsim(...a) }),
}));

// --- Import ---
import { stripeWebhook } from "./webhooks";

describe("stripeWebhook robustness tests", () => {
  let req: any;
  let res: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn()
    };

    req = {
      method: "POST",
      headers: { "stripe-signature": "dummy-sig" },
      rawBody: Buffer.from("{}")
    };
  });

  const setupMockEvent = (type: string, id: string, sessionData: any) => {
    mockConstructWebhookEvent.mockReturnValue({
      type,
      id,
      data: { object: sessionData }
    });
  };

  it("1. eSIM発行前で失敗 → Stripe再送 → 正しく再処理される (Idempotency fix)", async () => {
    const eventId = "evt_failed_retry";
    setupMockEvent("checkout.session.completed", eventId, {
      id: "cs_test_123",
      amount_total: 1000,
      metadata: { order_id: "order_123" }
    });

    // DB mock: The event exists but processed is false (failed previously)
    mockEventRefGet.mockResolvedValue({
      exists: true,
      data: () => ({ processed: false })
    });

    // DB mock: The order is not yet fulfilled
    mockGetOrderByStripeSessionId.mockResolvedValue({
      id: "order_123",
      amountJpy: 1000,
      status: "pending"
    });

    // Execute
    await (stripeWebhook as any)(req, res);

    // It should NOT skip. It should claim the event as processed: false,
    // then process it, then update to processed: true.
    expect(mockEventRefSet).toHaveBeenCalledWith(expect.objectContaining({ processed: false }));
    expect(mockGetOrderByStripeSessionId).toHaveBeenCalledWith("cs_test_123");
    expect(res.status).not.toHaveBeenCalledWith(500); // Should succeed (or fail later depending on bappy mock, but not skip)
  });

  it("2. 二重発行が起きない (Already processed check)", async () => {
    const eventId = "evt_already_processed";
    setupMockEvent("checkout.session.completed", eventId, {
      id: "cs_test_123",
      amount_total: 1000,
      metadata: { order_id: "order_123" }
    });

    // DB mock: The event exists and processed is true
    mockEventRefGet.mockResolvedValue({
      exists: true,
      data: () => ({ processed: true })
    });

    // Execute
    await (stripeWebhook as any)(req, res);

    // Should skip immediately
    expect(res.json).toHaveBeenCalledWith({ received: true, skipped: true });
    expect(mockGetOrderByStripeSessionId).not.toHaveBeenCalled();
  });

  it("2-b. 二重発行が起きない (Order fulfilled check)", async () => {
    const eventId = "evt_fulfilled_order";
    setupMockEvent("checkout.session.completed", eventId, {
      id: "cs_test_123",
      amount_total: 1000,
      metadata: { order_id: "order_123" }
    });

    // DB mock: The event is somehow not marked processed, but order is fulfilled
    mockEventRefGet.mockResolvedValue({ exists: false, data: () => undefined });

    mockGetOrderByStripeSessionId.mockResolvedValue({
      id: "order_123",
      amountJpy: 1000,
      status: "fulfilled"
    });

    // Execute
    await (stripeWebhook as any)(req, res);

    // It should check the order, see it's fulfilled, and not proceed to update it
    expect(mockGetOrderByStripeSessionId).toHaveBeenCalled();
    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("3. amount_total と注文金額の不一致を検知・拒否する", async () => {
    const eventId = "evt_amount_mismatch";
    setupMockEvent("checkout.session.completed", eventId, {
      id: "cs_test_123",
      amount_total: 999, // Mismatched!
      metadata: { order_id: "order_123" }
    });

    mockEventRefGet.mockResolvedValue({ exists: false, data: () => undefined });

    // Order has 1000 JPY
    mockGetOrderByStripeSessionId.mockResolvedValue({
      id: "order_123",
      amountJpy: 1000,
      status: "pending"
    });

    // Execute
    await (stripeWebhook as any)(req, res);

    // Should throw error and return 500, skipping order update
    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith("Internal server error");
  });

  it("4. topup発行失敗 → handleProvisioningFailure に esimLinkUuid を渡す（旧バグ回帰防止）", async () => {
    const eventId = "evt_topup_fail";
    setupMockEvent("checkout.session.completed", eventId, {
      id: "cs_topup",
      amount_total: 1800,
      amount_subtotal: 1800,
      metadata: { order_id: "order_topup" },
    });
    mockEventRefGet.mockResolvedValue({ exists: false, data: () => undefined });
    // topup注文（親eSIMのUUIDを持つ）
    mockGetOrderByStripeSessionId.mockResolvedValue({
      id: "order_topup",
      userId: "user_1",
      amountJpy: 1800,
      status: "pending",
      orderType: "topup",
      esimLinkUuid: "parent_uuid",
      provider: "esimaccess",
      stripeSessionId: "cs_topup",
    });
    // topup 実行を失敗させる → catch → handleProvisioningFailure
    mockProviderTopup.mockRejectedValue(new Error("topup provider down"));

    await (stripeWebhook as any)(req, res);

    // ★回帰防止: esimLinkUuid=親UUID / parentOrderId=null / isTopup=true で渡る
    expect(mockHandleProvisioningFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_topup",
        isTopup: true,
        esimLinkUuid: "parent_uuid",
        parentOrderId: null,
        provider: "esimaccess",
      }),
      expect.any(Error),
    );
    // 失敗時は pending_retry に落ちる
    expect(mockUpdateOrder).toHaveBeenCalledWith("order_topup", { status: "pending_retry" });
  });

  it("8. 処理中（in-flight）の並行配信は 500 を返し二重実行しない", async () => {
    setupMockEvent("checkout.session.completed", "evt_inflight", {
      id: "cs_x", amount_total: 1000, metadata: { order_id: "order_x" }
    });
    mockEventRefGet.mockResolvedValue({
      exists: true,
      data: () => ({ processed: false, claimedAt: Date.now() - 1000 }),
    });

    await (stripeWebhook as any)(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockGetOrderByStripeSessionId).not.toHaveBeenCalled();
    expect(mockEventRefUpdate).not.toHaveBeenCalled();
  });

  it("9. 部分返金は refunded に確定せず記録とオーナー通知に留める", async () => {
    setupMockEvent("charge.refunded", "evt_partial", {
      payment_intent: "pi_1", amount: 1000, amount_refunded: 400,
      refunds: { data: [{ id: "re_1" }] },
    });
    mockEventRefGet.mockResolvedValue({ exists: false, data: () => undefined });
    mockGetOrderByPaymentIntentId.mockResolvedValue({
      id: "order_p", userId: "u1", amountJpy: 1000, status: "fulfilled", refundStatus: "none",
    });

    await (stripeWebhook as any)(req, res);

    const refundedCall = mockUpdateOrder.mock.calls.find((c: any[]) => c[1]?.status === "refunded");
    expect(refundedCall).toBeUndefined();
    const partialCall = mockUpdateOrder.mock.calls.find((c: any[]) => c[1]?.partialRefundedJpy === 400);
    expect(partialCall).toBeTruthy();
    expect(mockNotifyOwner).toHaveBeenCalled();
    expect(mockEventRefUpdate).toHaveBeenCalledWith({ processed: true });
  });

  it("10. checkout.session.expired で pending 注文が cancelled になる", async () => {
    setupMockEvent("checkout.session.expired", "evt_expired", {
      id: "cs_old", metadata: { order_id: "order_e" },
    });
    mockEventRefGet.mockResolvedValue({ exists: false, data: () => undefined });
    mockGetOrderById.mockResolvedValue({ id: "order_e", status: "pending", stripeSessionId: "cs_old" });

    await (stripeWebhook as any)(req, res);

    expect(mockUpdateOrder).toHaveBeenCalledWith("order_e", { status: "cancelled" });
    expect(mockEventRefUpdate).toHaveBeenCalledWith({ processed: true });
  });
});
