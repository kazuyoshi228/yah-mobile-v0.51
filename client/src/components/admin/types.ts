/**
 * admin/types.ts — 管理画面共有型・定数・スタイル定義
 */

export type InquiryStatus = "pending" | "in_progress" | "resolved" | "closed";
export type AdminTab = "ai_first" | "analytics" | "orders" | "inquiries" | "plans" | "competitorPlans" | "access" | "incident" | "communication" | "refunds";
export type Period = "24h" | "7d" | "30d" | "90d";

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

export const STATUS_LABELS: Record<InquiryStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const STATUS_COLORS: Record<InquiryStatus, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  in_progress: "bg-blue-100 text-blue-800 border-blue-200",
  resolved: "bg-green-100 text-green-800 border-green-200",
  closed: "bg-gray-100 text-gray-500 border-gray-200",
};

/** ラベル用スタイル（大文字・トラッキング） */
export const labelStyle: React.CSSProperties = {
  fontFamily: "'National2', system-ui, sans-serif",
  fontSize: "0.6875rem",
  fontWeight: 500,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
};

/** ボディ用スタイル */
export const bodyStyle: React.CSSProperties = {
  fontFamily: "'National2', system-ui, sans-serif",
};

export type PlanFormData = {
  bappyPlanId: string;
  name: string;
  dataGb: string;
  validityDays: string;
  priceJpy: string;
  wholesalePriceUsd: string;
  regions: string;
  sponsorProfile: string;
  planType: "initial" | "topup" | "";
  isActive: boolean;
};

export const EMPTY_PLAN_FORM: PlanFormData = {
  bappyPlanId: "",
  name: "",
  dataGb: "",
  validityDays: "",
  priceJpy: "",
  wholesalePriceUsd: "",
  regions: "",
  sponsorProfile: "",
  planType: "",
  isActive: true,
};

export type PlanRow = {
  id: string;
  bappyPlanId: string;
  name: string;
  dataGb: string;
  validityDays: number;
  priceJpy: number;
  regions: string | null;
  sponsorProfile: string | null;
  planType: "initial" | "topup" | null;
  isActive: boolean;
  sortOrder?: number;
  createdAt: number;
  updatedAt: number;
  // 柱2: プロバイダ/卸情報（eSIMAccess取り込みで自動付与。既存Bappyプランは未設定）
  provider?: "esimaccess" | "bappy" | null;
  providerPlanId?: string | null;
  wholesalePriceUsd?: number | null;
  network?: string | null;
  ipExport?: string | null;
};

export type EditingCell = { planId: string; field: "name" | "dataGb" | "validityDays" | "priceJpy" | "wholesalePriceUsd" };

// ─────────────────────────────────────────────
// Comparison（「How we compare.」比較テーブル）
// ─────────────────────────────────────────────

export type ComparisonRow = {
  id: string;
  serviceName: string;
  isHighlight: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ComparisonColumn = {
  id: string;
  colKey: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ComparisonCell = {
  id: string;
  rowId: string;
  colKey: string;
  value: string;
  createdAt: number;
  updatedAt: number;
};

/** セル編集中の位置（行ID + 列キー） */
export type ComparisonEditingCell = {
  rowId: string;
  colKey: string;
};
