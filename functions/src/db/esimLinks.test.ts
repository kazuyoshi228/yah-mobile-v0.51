import { describe, it, expect, vi, beforeEach } from "vitest";

// core をモックし、esimLinks リポジトリの doc-ID 規約と既定値を検証する。
const { docRefMock, setMock, getMock, updateMock, docMock } = vi.hoisted(() => {
  const setMock = vi.fn();
  const getMock = vi.fn();
  const updateMock = vi.fn();
  const docRefMock = { set: setMock, get: getMock, update: updateMock };
  const docMock = vi.fn(() => docRefMock);
  return { docRefMock, setMock, getMock, updateMock, docMock };
});

vi.mock("./core", () => ({
  collections: { esimLinks: { doc: docMock }, esimActivations: { add: vi.fn() } },
  docToObj: (snap: { exists: boolean; id?: string; data?: () => Record<string, unknown> }) =>
    snap.exists ? { id: snap.id, ...snap.data!() } : null,
  queryToArr: () => [],
}));

import { createEsimLink, updateEsimLink } from "./esimLinks";

describe("db/esimLinks — リポジトリ（P2）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createEsimLink: doc ID = bappyLinkUuid（providerRef）で作成し status 既定は provisioning", async () => {
    getMock.mockResolvedValue({ exists: true, id: "uuid-1", data: () => ({ status: "provisioning" }) });
    await createEsimLink({ bappyLinkUuid: "uuid-1", orderId: "o1", userId: "u1" } as never);
    expect(docMock).toHaveBeenCalledWith("uuid-1");
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "provisioning", bappyLinkUuid: "uuid-1", createdAt: expect.any(Number) }),
    );
  });

  it("updateEsimLink: updatedAt を必ず添える", async () => {
    updateMock.mockResolvedValue(undefined);
    await updateEsimLink("uuid-1", { dataRemainingMb: 100 });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ dataRemainingMb: 100, updatedAt: expect.any(Number) }),
    );
  });
});
