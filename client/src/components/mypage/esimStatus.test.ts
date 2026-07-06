import { describe, it, expect } from "vitest";
import { deriveEsimStatus, isLowData, formatEsimExpiry } from "./esimStatus";

describe("deriveEsimStatus", () => {
  it("未有効化（lastActiveAt無し・status非active）→ ready", () => {
    expect(deriveEsimStatus({ status: null, lastActiveAt: null }).key).toBe("ready");
    expect(deriveEsimStatus({ status: "inactive" }).key).toBe("ready");
  });

  it("発行済み(status='active')でも未インストール(lastActiveAt無し・データ未消費)なら ready", () => {
    // fulfillEsim は発行時に status='active' を即セットする。実データ相当のケース。
    expect(deriveEsimStatus({
      status: "active", lastActiveAt: null, dataRemainingMb: 1000, dataTotalMb: 1000, expiryDate: null,
    }).key).toBe("ready");
  });

  it("有効化済み・データ十分 → active（パルスあり）", () => {
    const r = deriveEsimStatus({ status: "active", lastActiveAt: 1_700_000_000_000, dataRemainingMb: 4000, dataTotalMb: 5000 });
    expect(r.key).toBe("active");
    expect(r.pulse).toBe(true);
  });

  it("有効化済み・残量0 → topup", () => {
    expect(deriveEsimStatus({ status: "active", dataRemainingMb: 0, dataTotalMb: 5000 }).key).toBe("topup");
  });

  it("有効化済み・残量10%以下 → topup", () => {
    expect(deriveEsimStatus({ status: "active", dataRemainingMb: 500, dataTotalMb: 5000 }).key).toBe("topup");
    expect(deriveEsimStatus({ status: "active", dataRemainingMb: 501, dataTotalMb: 5000 }).key).toBe("active");
  });

  it("status=expired → expired（残量に関係なく最優先）", () => {
    expect(deriveEsimStatus({ status: "expired", dataRemainingMb: 4000, dataTotalMb: 5000 }).key).toBe("expired");
  });

  it("expiryDate 経過 → expired", () => {
    expect(deriveEsimStatus({ status: "active", expiryDate: "2000-01-01T00:00:00Z" }).key).toBe("expired");
  });

  it("lastActiveAt があれば status 未設定でも有効化扱い", () => {
    expect(deriveEsimStatus({ status: null, lastActiveAt: 1_700_000_000_000, dataRemainingMb: 4000, dataTotalMb: 5000 }).key).toBe("active");
  });
});

describe("isLowData", () => {
  it("null は low ではない", () => expect(isLowData(null, 5000)).toBe(false));
  it("0以下は low", () => expect(isLowData(0, 5000)).toBe(true));
  it("10%境界", () => {
    expect(isLowData(500, 5000)).toBe(true);
    expect(isLowData(501, 5000)).toBe(false);
  });
});

describe("formatEsimExpiry", () => {
  it("expiryDate あり → Expires <日時>", () => {
    const s = formatEsimExpiry({ expiryDate: "2026-08-05T00:30:00Z" }, 7);
    expect(s).toMatch(/^Expires /);
  });
  it("expiryDate なし → Valid for N days（validityDays 由来）", () => {
    expect(formatEsimExpiry({ expiryDate: null }, 7)).toBe("Valid for 7 days · from activation");
  });
  it("expiryDate も validityDays も無ければ null", () => {
    expect(formatEsimExpiry({ expiryDate: null }, null)).toBeNull();
    expect(formatEsimExpiry({ expiryDate: null }, undefined)).toBeNull();
  });
});
