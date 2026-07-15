/**
 * plans.ts — SSOT(Firestore plans) をビルド時に読む（design_astro_geo_p1.md §2.4）
 *
 * 方式: Firestore REST（公開 apiKey）。`plans` は firestore.rules で `allow read: if true`（公開）。
 * → firebase-admin / ADC を足さずに静的HTMLへ価格を焼ける。apiKey は公開クライアント値
 *   （client/src/lib/firebase.ts にも同値がコミット済み）。
 */
const PROJECT_ID = "yah-mobile-v1-3ed24";
const API_KEY =
  (typeof process !== "undefined" && process.env?.VITE_FIREBASE_API_KEY) ||
  "AIzaSyDlX00FbPP_Ij709LN0Xtrc26VjFh-57Js";

export interface Plan {
  id: string; // Firestore docID
  name: string;
  dataGb: number | null;
  validityDays: number | null;
  priceJpy: number | null;
  providerPlanId: string | null;
  planType: "initial" | "topup" | null;
  isActive: boolean;
}

// Firestore REST の typed value を素の JS 値へ。
function unwrap(v: any): any {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  return null;
}

let _cache: Plan[] | null = null;

/** 全 plans をビルド時に1回取得（公開REST）。 */
export async function getAllPlans(): Promise<Plan[]> {
  if (_cache) return _cache;
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/plans?key=${API_KEY}&pageSize=300`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[plans] Firestore REST failed: ${res.status}`);
  const json = (await res.json()) as { documents?: any[] };
  _cache = (json.documents ?? []).map((doc) => {
    const f = doc.fields ?? {};
    const id = String(doc.name).split("/").pop() as string;
    return {
      id,
      name: (unwrap(f.name) as string) ?? "",
      dataGb: unwrap(f.dataGb),
      validityDays: unwrap(f.validityDays),
      priceJpy: unwrap(f.priceJpy),
      providerPlanId: unwrap(f.providerPlanId),
      planType: unwrap(f.planType),
      isActive: unwrap(f.isActive) === true,
    } as Plan;
  });
  return _cache;
}

/**
 * priceBindings（docID か providerPlanId のいずれか）に該当する有効プランを、
 * bindings の順序で返す。docID / providerPlanId の両方で照合（feedの識別子ゆれに頑健）。
 */
export async function getPlansByBindings(bindings: string[]): Promise<Plan[]> {
  const all = await getAllPlans();
  const byId = new Map(all.map((p) => [p.id, p]));
  const byProvider = new Map(all.filter((p) => p.providerPlanId).map((p) => [p.providerPlanId as string, p]));
  const out: Plan[] = [];
  for (const key of bindings) {
    const hit = byId.get(key) ?? byProvider.get(key);
    if (hit && hit.isActive) out.push(hit);
  }
  return out;
}
