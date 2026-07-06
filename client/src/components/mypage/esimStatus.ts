// eSIM の利用ライフサイクル・ステータスを実フィールドから導出する。
// 注文ステータス（order.status）とは別系統：こちらは「いま使えるか」を表す。
// 優先順位: Expired → Ready to Install →（Need Top-up / Active）

export type EsimStatusKey = "ready" | "active" | "topup" | "expired";

export interface EsimStatusInput {
  status?: string | null;
  lastActiveAt?: number | null;
  dataRemainingMb?: number | null;
  dataTotalMb?: number | null;
  expiryDate?: Date | string | null;
}

export interface EsimStatusResult {
  key: EsimStatusKey;
  label: string;
  /** ステータスドットの Tailwind 色クラス */
  dotClass: string;
  /** ドットをパルスさせるか（Active のみ） */
  pulse: boolean;
}

/** データ残量が閾値（10%）以下、または枯渇（0以下）なら true */
export function isLowData(remainingMb?: number | null, totalMb?: number | null): boolean {
  if (remainingMb == null) return false;
  if (remainingMb <= 0) return true;
  if (totalMb != null && totalMb > 0 && remainingMb / totalMb <= 0.1) return true;
  return false;
}

export function deriveEsimStatus(esim: EsimStatusInput): EsimStatusResult {
  const now = Date.now();
  const expired =
    esim.status === "expired" ||
    (esim.expiryDate != null && new Date(esim.expiryDate).getTime() < now);
  // 「実際に有効化された」証跡で判定する。
  // ※ webhooks.ts の fulfillEsim は発行時に status="active" を即セットするため、
  //   status==="active" は「発行済み」を意味し、端末での有効化ではない。
  //   有効化は lastActiveAt（webhooks_bappy が付与）／データ消費（remaining<total）で判定する。
  const activated =
    esim.lastActiveAt != null ||
    (esim.dataRemainingMb != null && esim.dataTotalMb != null && esim.dataRemainingMb < esim.dataTotalMb);

  if (expired) return { key: "expired", label: "Expired", dotClass: "bg-gray-400", pulse: false };
  if (!activated) return { key: "ready", label: "Ready to Install", dotClass: "bg-blue-400", pulse: false };
  if (isLowData(esim.dataRemainingMb, esim.dataTotalMb))
    return { key: "topup", label: "Need Top-up", dotClass: "bg-orange-400", pulse: false };
  return { key: "active", label: "Active", dotClass: "bg-green-400", pulse: true };
}

/**
 * eSIM の期限表示を返す。
 * - 有効化済み（expiryDate あり）→ 実際の期限日時「Expires <日時>」
 * - 未有効化（expiryDate なし）→ plan の有効日数で「Valid for N days · from activation」
 *   （実eSIMの期限は有効化時にBappyが付与するため、未有効化では日付が存在しない）
 */
export function formatEsimExpiry(
  esim: { expiryDate?: Date | string | null },
  validityDays?: number | null,
): string | null {
  if (esim.expiryDate) {
    return `Expires ${new Date(esim.expiryDate).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    })}`;
  }
  if (validityDays) return `Valid for ${validityDays} days · from activation`;
  return null;
}
