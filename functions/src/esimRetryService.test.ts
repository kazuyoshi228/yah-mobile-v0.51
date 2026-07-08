import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleProvisioningFailure, processPendingRetries, ProvisioningContext } from "./esimRetryService";
import * as db from "./db";
import * as notify from "./adapters/notify";
import * as bappy from "./bappy";
import * as mailer from "./mailer";

// Mock ./bappy（eSIM発行/トップアップAPI）
vi.mock("./bappy", () => ({
  createLink: vi.fn(),
  addTopupPlan: vi.fn(),
}));

// Mock ENV
vi.mock("./env", () => ({
  ENV: {
    ownerEmail: "owner@example.com",
    omaxTechEmail: "tech@example.com"
  }
}));

// Mock DB
vi.mock("./db", () => ({
  createRetryJob: vi.fn(),
  createIncidentLog: vi.fn(),
  updateOrder: vi.fn(),
  createEsimLink: vi.fn(),
  createEsimActivation: vi.fn(),
  getEsimLinkByUuid: vi.fn(),
  createNotification: vi.fn(),
  getUserById: vi.fn(),
  getPendingEsimRetryJobs: vi.fn(),
  updateRetryJob: vi.fn(),
  resolveIncident: vi.fn(),
  markIncidentNotified: vi.fn(),
  // topup経路が collections.plans.where().limit().get() を参照する（プラン名/容量のjoin）
  collections: {
    plans: { where: () => ({ limit: () => ({ get: () => Promise.resolve({ empty: true, docs: [] }) }) }) },
  },
}));

// Mock notify
vi.mock("./adapters/notify", () => ({
  notifyOwner: vi.fn()
}));

// Mock mailer（ビルダーは {subject, html} を返す＝呼び出し側の分割代入が成立するように）
vi.mock("./mailer", () => ({
  sendEmail: vi.fn(),
  buildEsimDelayedEmail: vi.fn(() => ({ subject: "delayed", html: "<p>delayed</p>" })),
  buildEsimFailedEmail: vi.fn(() => ({ subject: "failed", html: "<p>failed</p>" })),
  buildEsimReadyEmail: vi.fn(() => ({ subject: "ready", html: "<p>ready</p>" })),
}));

describe("esimRetryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleProvisioningFailure", () => {
    it("should create a retry job, incident log, and send notifications", async () => {
      (db.createRetryJob as any).mockResolvedValue("job_123");
      (db.createIncidentLog as any).mockResolvedValue("incident_456");

      const ctx: ProvisioningContext = {
        orderId: "order_123",
        userId: "user_123",
        bappyPlanId: "plan_123",
        stripeSessionId: "cs_test_123",
        isTopup: false,
      };

      const error = new Error("Bappy API is down");

      await handleProvisioningFailure(ctx, error);

      expect(db.createRetryJob).toHaveBeenCalledWith({
        orderId: "order_123",
        userId: "user_123",
        bappyPlanId: "plan_123",
        provider: "bappy", // ctx.provider 未設定時のフォールバック（柱2）
        stripeSessionId: "cs_test_123",
        isTopup: false,
        parentOrderId: null,
        esimLinkUuid: null,
        maxRetries: 3,
      });

      expect(db.createIncidentLog).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "esim_failure",
          severity: "critical",
          orderId: "order_123",
          userId: "user_123",
        })
      );

      expect(notify.notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("order_123"),
          content: expect.stringContaining("Bappy API is down")
        })
      );
    });

    it("柱2: ctx.provider を retry job に伝播する（esimaccess）", async () => {
      (db.createRetryJob as any).mockResolvedValue("job_ea");
      (db.createIncidentLog as any).mockResolvedValue("incident_ea");

      await handleProvisioningFailure(
        { orderId: "o_ea", userId: "u", bappyPlanId: "PYTKZG843", provider: "esimaccess", stripeSessionId: "cs", isTopup: false },
        new Error("timeout"),
      );

      expect(db.createRetryJob).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: "o_ea", provider: "esimaccess" }),
      );
    });
  });

  describe("processPendingRetries", () => {
    // 新規eSIM発行のリトライジョブ（isTopup:false）の雛形
    const newEsimJob = (overrides: Record<string, any> = {}) => ({
      id: "job_1",
      orderId: "order_1",
      userId: "user_1",
      bappyPlanId: "plan_1",
      stripeSessionId: "cs_1",
      isTopup: false,
      parentOrderId: null,
      esimLinkUuid: null,
      retryCount: 0,
      maxRetries: 3,
      status: "pending",
      ...overrides,
    });

    it("最終試行(3回目)で失敗したらオーナー通知・失敗メール・失敗通知を出し注文をfailedにする", async () => {
      // retryCount:2 → attemptNum=3 = maxRetries（最終試行）
      (db.getPendingEsimRetryJobs as any).mockResolvedValue([newEsimJob({ retryCount: 2 })]);
      (bappy.createLink as any).mockRejectedValue(new Error("Bappy still down"));
      (db.getUserById as any).mockResolvedValue({ id: "user_1", email: "user@example.com" });

      const result = await processPendingRetries();

      expect(result.failed).toBe(1);
      expect(db.updateOrder).toHaveBeenCalledWith("order_1", { status: "failed" });
      expect(notify.notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("最終失敗") })
      );
      expect(db.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: "order_failed", userId: "user_1" })
      );
      expect(mailer.buildEsimFailedEmail).toHaveBeenCalledWith({ orderId: "order_1" });
      expect(mailer.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "user@example.com" })
      );
    });

    it("2回目で回復したら注文をfulfilledにし成功メール・成功通知・回復通知を出す", async () => {
      // retryCount:1 → attemptNum=2（>1・最終前）で成功
      (db.getPendingEsimRetryJobs as any).mockResolvedValue([newEsimJob({ retryCount: 1 })]);
      (bappy.createLink as any).mockResolvedValue({
        uuid: "link_uuid",
        iccid: "8900000000000000000",
        lpaProfile: "LPA:1$smdp$token",
        appleActivationUrl: null,
        androidActivationUrl: null,
      });
      (db.getUserById as any).mockResolvedValue({ id: "user_1", email: "user@example.com" });

      const result = await processPendingRetries();

      expect(result.succeeded).toBe(1);
      expect(db.updateOrder).toHaveBeenCalledWith("order_1", { status: "fulfilled" });
      expect(db.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: "order_fulfilled", userId: "user_1" })
      );
      expect(mailer.buildEsimReadyEmail).toHaveBeenCalledWith({ orderId: "order_1" });
      expect(mailer.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "user@example.com" })
      );
      // attemptNum(2) > 1 なのでオーナーへ回復通知
      expect(notify.notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("自動回復") })
      );
    });

    it("topupリトライ: esimLinkUuid で親eSIMを解決し topup→activation→fulfilled（旧バグの回帰防止）", async () => {
      const topupJob = {
        id: "job_t", orderId: "order_t", userId: "user_1", bappyPlanId: "TOPUP_x",
        provider: "bappy", esimLinkUuid: "parent_uuid", parentOrderId: null,
        isTopup: true, retryCount: 0, maxRetries: 3, status: "pending",
      };
      (db.getPendingEsimRetryJobs as any).mockResolvedValue([topupJob]);
      (bappy.addTopupPlan as any).mockResolvedValue({
        uuid: "act_uuid", planId: "TOPUP_x", dataRemainingMb: 1024, dataTotalMb: 1024,
        expiryDate: "2026-08-01T00:00:00.000Z", status: "active",
      });
      (db.getEsimLinkByUuid as any).mockResolvedValue({ id: "esimdoc_1", userId: "user_1" });
      (db.getUserById as any).mockResolvedValue({ id: "user_1", email: "u@example.com" });

      const result = await processPendingRetries();

      expect(result.succeeded).toBe(1);
      // ★回帰防止: 親eSIMは esimLinkUuid で解決（旧実装は getEsimLinkByOrderId(undefined) で必ず失敗）
      expect(db.getEsimLinkByUuid).toHaveBeenCalledWith("parent_uuid");
      // provider.topup が親UUIDへ実行（bappyProvider経由で addTopupPlan）
      expect(bappy.addTopupPlan).toHaveBeenCalledWith({ identifier: "parent_uuid", planId: "TOPUP_x" });
      expect(db.createEsimActivation).toHaveBeenCalledWith(
        expect.objectContaining({ esimLinkId: "esimdoc_1", activationType: "topup" }),
      );
      expect(db.updateOrder).toHaveBeenCalledWith("order_t", { status: "fulfilled" });
    });
  });
});
