import { describe, it, expect, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

// core は module 評価時に getFirebaseDb() を呼ぶため firebase をモックする。
vi.mock("../firebase", () => ({
  getFirebaseDb: () => ({ collection: (name: string) => ({ __name: name }) }),
  getFirebaseAuth: () => ({}),
}));

import { toMs, docToObj, queryToArr, collections } from "./core";

describe("db/core — 変換ユーティリティ（P2）", () => {
  it("toMs: Timestamp/Date/number を epoch ms に正規化", () => {
    expect(toMs(Timestamp.fromMillis(1751000000000))).toBe(1751000000000);
    expect(toMs(new Date(1751000000000))).toBe(1751000000000);
    expect(toMs(1751000000000)).toBe(1751000000000);
  });

  it("toMs: 不明値は現在時刻（number を返す）", () => {
    const before = Date.now();
    const v = toMs(null);
    expect(v).toBeGreaterThanOrEqual(before);
  });

  it("docToObj: 存在しないsnapは null / 存在すれば id をマージ", () => {
    expect(docToObj({ exists: false } as never)).toBeNull();
    const snap = { exists: true, id: "doc1", data: () => ({ a: 1 }) } as never;
    expect(docToObj<{ id: string; a: number }>(snap)).toEqual({ id: "doc1", a: 1 });
  });

  it("queryToArr: docs を {id, ...data} の配列へ", () => {
    const snap = {
      docs: [
        { id: "x", data: () => ({ n: 1 }) },
        { id: "y", data: () => ({ n: 2 }) },
      ],
    } as never;
    expect(queryToArr<{ id: string; n: number }>(snap)).toEqual([
      { id: "x", n: 1 },
      { id: "y", n: 2 },
    ]);
  });

  it("collections: 主要コレクション名が定義されている", () => {
    // コレクション名のタイポ検知（Firestoreの実名と1:1）
    expect((collections.orders as unknown as { __name: string }).__name).toBe("orders");
    expect((collections.esimLinks as unknown as { __name: string }).__name).toBe("esim_links");
    expect((collections.esimRetryJobs as unknown as { __name: string }).__name).toBe("esim_retry_jobs");
    expect((collections.incidentLogs as unknown as { __name: string }).__name).toBe("incident_logs");
  });
});
