/**
 * competitor.ts — 競合比較表(SSOT: competitorPlans/main)をビルド時に読む。
 *
 * SPA client/src/components/app/ComparisonTable.tsx と同一のデータモデル・整形ロジックを
 * 静的に再現する。competitorPlans は firestore.rules で `allow read: if true`（公開）。
 * feed.showCompetitorTable が真のときだけページで描画する。
 */
const PROJECT_ID = "yah-mobile-v1-3ed24";
const API_KEY =
  (typeof process !== "undefined" && process.env?.VITE_FIREBASE_API_KEY) ||
  "AIzaSyDlX00FbPP_Ij709LN0Xtrc26VjFh-57Js";
const FIXED_COL_KEY = "service";

// Firestore REST の typed value を再帰的に素の値へ（map/array対応）。
function unwrap(v: any): any {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) {
    const out: Record<string, any> = {};
    const f = v.mapValue.fields ?? {};
    for (const k of Object.keys(f)) out[k] = unwrap(f[k]);
    return out;
  }
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(unwrap);
  return null;
}

const truthy = (x: unknown) => x === true || x === "true";

export interface CompareColumn { colKey: string; label: string; }
export interface CompareTable {
  columns: CompareColumn[];
  rows: Array<Record<string, string | boolean>>; // { service, highlight, [colKey]: value }
}

/** competitorPlans/main を取得し、アクティブ列/行を sortOrder 順に整形。無ければ null。 */
export async function getCompetitorTable(): Promise<CompareTable | null> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/competitorPlans/main?key=${API_KEY}`;
  let doc: any;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    doc = await res.json();
  } catch {
    return null;
  }
  const f = doc?.fields;
  if (!f?.columns || !f?.rows) return null;

  const rawCols: any[] = unwrap(f.columns) ?? [];
  const rawRows: any[] = unwrap(f.rows) ?? [];

  const columns: CompareColumn[] = rawCols
    .filter((c) => truthy(c?.isActive))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => ({ colKey: String(c.id), label: String(c.label ?? c.id) }));

  const rows = rawRows
    .filter((r) => truthy(r?.isActive))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((r) => {
      const rec: Record<string, string | boolean> = {
        service: String(r.serviceName ?? ""),
        highlight: truthy(r.isHighlight),
      };
      for (const col of columns) {
        if (col.colKey === FIXED_COL_KEY) continue;
        rec[col.colKey] = (r.cells && r.cells[col.colKey]) ?? "—";
      }
      return rec;
    });

  if (columns.length === 0 || rows.length === 0) return null;
  return { columns, rows };
}
