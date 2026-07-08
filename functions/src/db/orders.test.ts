import { describe, it, expect, vi, beforeEach } from "vitest";

// core（Firestore接続）をモックし、orders リポジトリのクエリ組み立て・防御を検証する。
const { docGetMock, docUpdateMock, addMock, whereMock, limitGetMock } = vi.hoisted(() => ({
  docGetMock: vi.fn(),
  docUpdateMock: vi.fn(),
  addMock: vi.fn(),
  whereMock: vi.fn(),
  limitGetMock: vi.fn(),
}));

vi.mock("./core", () => {
  const chain = {
    where: (...a: unknown[]) => { whereMock(...a); return chain; },
    orderBy: () => chain,
    limit: () => chain,
    get: (...a: unknown[]) => limitGetMock(...a),
  };
  return {
    collections: {
      orders: {
        add: addMock,
        doc: () => ({ get: docGetMock, update: docUpdateMock }),
        where: chain.where,
        orderBy: chain.orderBy,
      },
    },
    docToObj: (snap: { exists: boolean; id?: string; data?: () => Record<string, unknown> }) =>
      snap.exists ? { id: snap.id, ...snap.data!() } : null,
    queryToArr: (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) =>
      snap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
});

import { getOrderById, getOrderByStripeSessionId, updateOrder } from "./orders";

describe("db/orders — リポジトリ（P2）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getOrderById: userId 指定時は所有者不一致で null（IDOR防御）", async () => {
    docGetMock.mockResolvedValue({ exists: true, id: "o1", data: () => ({ userId: "owner" }) });
    expect(await getOrderById("o1", "owner")).toMatchObject({ id: "o1" });
    expect(await getOrderById("o1", "attacker")).toBeNull();
  });

  it("getOrderByStripeSessionId: stripeSessionId で where 検索し、空なら null", async () => {
    limitGetMock.mockResolvedValue({ empty: true, docs: [] });
    expect(await getOrderByStripeSessionId("cs_x")).toBeNull();
    expect(whereMock).toHaveBeenCalledWith("stripeSessionId", "==", "cs_x");

    limitGetMock.mockResolvedValue({ empty: false, docs: [{ id: "o2", data: () => ({ amountJpy: 1800 }) }] });
    expect(await getOrderByStripeSessionId("cs_y")).toMatchObject({ id: "o2", amountJpy: 1800 });
  });

  it("updateOrder: updatedAt を必ず添えて update する", async () => {
    docUpdateMock.mockResolvedValue(undefined);
    await updateOrder("o1", { status: "fulfilled" });
    expect(docUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "fulfilled", updatedAt: expect.any(Number) }),
    );
  });
});
