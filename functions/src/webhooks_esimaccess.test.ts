import { describe, it, expect, vi, beforeEach } from "vitest";

// onRequest はハンドラをそのまま返す（直接 (req,res) で呼べるように）。
vi.mock("firebase-functions/v2/https", () => ({ onRequest: (_opts: unknown, h: unknown) => h }));
vi.mock("firebase-functions/logger", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("firebase-functions/params", () => ({
  defineSecret: (name: string) => ({ value: () => (name === "ESIMACCESS_WEBHOOK_TOKEN" ? "secret-tok" : "x") }),
}));

const { createMock, deleteMock, whereGetMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteMock: vi.fn(),
  whereGetMock: vi.fn(),
}));
const getEsimLinkByOrderId = vi.fn();
const updateEsimLink = vi.fn();
const createNotification = vi.fn();
vi.mock("./db", () => ({
  db: { collection: () => ({ doc: () => ({ create: createMock, delete: deleteMock }) }) },
  collections: { esimLinks: { where: () => ({ limit: () => ({ get: whereGetMock }) }) } },
  getEsimLinkByOrderId: (...a: unknown[]) => getEsimLinkByOrderId(...a),
  updateEsimLink: (...a: unknown[]) => updateEsimLink(...a),
  createNotification: (...a: unknown[]) => createNotification(...a),
}));
const getEsimDetail = vi.fn();
vi.mock("./providers/esimaccess", () => ({ esimaccessProvider: { getEsimDetail: (...a: unknown[]) => getEsimDetail(...a) } }));
vi.mock("./esimaccess/auth", () => ({ esimAccessCode: { value: () => "x" }, esimSecretKey: { value: () => "x" } }));
vi.mock("./adapters/notify", () => ({ notifyOwner: vi.fn().mockResolvedValue(undefined) }));

import { esimaccessWebhook } from "./webhooks_esimaccess";

type Res = { statusCode: number; body: unknown; status: (c: number) => Res; send: (b: unknown) => Res; json: (b: unknown) => Res };
function mkRes(): Res {
  const res = { statusCode: 200, body: undefined } as Res;
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const mkReq = (over: Record<string, unknown> = {}) => ({
  method: "POST",
  query: { token: "secret-tok" },
  headers: { "x-forwarded-for": "3.1.131.226" },
  ip: "3.1.131.226",
  body: {},
  ...over,
});
const call = (req: unknown, res: unknown) => (esimaccessWebhook as unknown as (q: unknown, s: unknown) => Promise<void>)(req, res);

describe("esimaccessWebhook — 多層防御（柱1/§7）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockResolvedValue(undefined); // 既定=初回
    deleteMock.mockResolvedValue(undefined);
    createNotification.mockResolvedValue(undefined);
    updateEsimLink.mockResolvedValue(undefined);
  });

  it("トークン不一致は 403", async () => {
    const res = mkRes();
    await call(mkReq({ query: { token: "wrong" } }), res);
    expect(res.statusCode).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("POST以外は 405", async () => {
    const res = mkRes();
    await call(mkReq({ method: "GET" }), res);
    expect(res.statusCode).toBe(405);
  });

  it("CHECK_HEALTH は 200（冪等処理せず）", async () => {
    const res = mkRes();
    await call(mkReq({ body: { notifyType: "CHECK_HEALTH" } }), res);
    expect(res.statusCode).toBe(200);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("重複 notifyId は無視（create が既存で失敗）", async () => {
    createMock.mockRejectedValue(new Error("already-exists"));
    const res = mkRes();
    await call(mkReq({ body: { notifyType: "ORDER_STATUS", notifyId: "n1", content: { transactionId: "o1" } } }), res);
    expect(res.body).toMatchObject({ duplicate: true });
    expect(getEsimLinkByOrderId).not.toHaveBeenCalled();
  });

  it("ORDER_STATUS は /esim/query で裏取りして esim_link 更新", async () => {
    getEsimLinkByOrderId.mockResolvedValue({ id: "L1", providerRef: "ET1", userId: "u", orderId: "o1" });
    getEsimDetail.mockResolvedValue({ status: "active", iccid: "8931", lpaProfile: "LPA", dataRemainingMb: 5120, dataTotalMb: 5120, expiryDate: 123 });
    const res = mkRes();
    await call(mkReq({ body: { notifyType: "ORDER_STATUS", notifyId: "n2", content: { transactionId: "o1" } } }), res);
    expect(getEsimDetail).toHaveBeenCalledWith("ET1");
    expect(updateEsimLink).toHaveBeenCalledWith("ET1", expect.objectContaining({ status: "active", iccid: "8931" }));
    expect(res.body).toMatchObject({ received: true });
  });

  it("DATA_USAGE は残量アラート通知を作成", async () => {
    getEsimLinkByOrderId.mockResolvedValue({ id: "L1", providerRef: "ET1", userId: "u9", orderId: "o1" });
    getEsimDetail.mockResolvedValue({ status: "active", dataRemainingMb: 50, dataTotalMb: 5120, expiryDate: null });
    const res = mkRes();
    await call(mkReq({ body: { notifyType: "DATA_USAGE", notifyId: "n3", content: { transactionId: "o1", iccid: "8931" } } }), res);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "u9", type: "data_threshold_100" }));
  });
});
