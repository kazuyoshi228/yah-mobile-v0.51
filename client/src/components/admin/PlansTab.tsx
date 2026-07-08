/**
 * admin/PlansTab.tsx — eSIMプラン管理タブ (BaaS First版)
 */
import { useFirestoreCollection } from "@/hooks/useFirestoreCollection";
import { getFirebaseDb } from "@/lib/firebase";
import {
  collection,
  query,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  orderBy,
  limit,
  writeBatch,
} from "firebase/firestore";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { callFunction, CALLABLE } from "@/lib/callable";
import {
  EMPTY_PLAN_FORM,
  EditingCell,
  PlanFormData,
  PlanRow,
} from "./types";

// ─────────────────────────────────────────────
// PlanFormModal
// ─────────────────────────────────────────────
function PlanFormModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: PlanRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = plan !== null;
  const [form, setForm] = useState<PlanFormData>(
    isEdit
      ? {
          bappyPlanId: plan.bappyPlanId,
          name: plan.name,
          dataGb: plan.dataGb,
          validityDays: String(plan.validityDays),
          priceJpy: String(plan.priceJpy),
          wholesalePriceUsd: plan.wholesalePriceUsd != null ? String(plan.wholesalePriceUsd) : "",
          regions: plan.regions ?? "",
          sponsorProfile: plan.sponsorProfile ?? "",
          planType: plan.planType ?? "",
          isActive: plan.isActive,
        }
      : EMPTY_PLAN_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const validityDays = parseInt(form.validityDays, 10);
    const priceJpy = parseInt(form.priceJpy, 10);
    if (isNaN(validityDays) || validityDays <= 0) {
      setError("有効日数は正の整数を入力してください");
      return;
    }
    if (isNaN(priceJpy) || priceJpy <= 0) {
      setError("価格は正の整数を入力してください");
      return;
    }
    // 卸USD（任意）：空なら既存値を触らない。数値なら反映。
    const wholesaleRaw = form.wholesalePriceUsd.trim();
    const wholesalePriceUsd = wholesaleRaw === "" ? undefined : Number(wholesaleRaw);
    if (wholesalePriceUsd !== undefined && (!Number.isFinite(wholesalePriceUsd) || wholesalePriceUsd < 0)) {
      setError("卸(USD)は0以上の数値で入力してください");
      return;
    }
    const payload = {
      bappyPlanId: form.bappyPlanId.trim(),
      name: form.name.trim(),
      dataGb: form.dataGb.trim(),
      validityDays,
      priceJpy,
      ...(wholesalePriceUsd !== undefined ? { wholesalePriceUsd } : {}),
      regions: form.regions.trim() || null,
      sponsorProfile: form.sponsorProfile.trim() || null,
      planType: form.planType || null,
      isActive: form.isActive,
      updatedAt: Date.now(),
    };
    setIsPending(true);
    try {
      if (isEdit) {
        await updateDoc(doc(getFirebaseDb(), "plans", plan.id), payload);
        toast.success("Plan updated successfully");
      } else {
        await addDoc(collection(getFirebaseDb(), "plans"), {
          ...payload,
          sortOrder: Date.now(),
          createdAt: Date.now(),
        });
        toast.success("Plan created successfully");
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || "Failed to save plan");
    } finally {
      setIsPending(false);
    }
  };

  const inputClass =
    "w-full bg-white border border-[#D7D7D7] px-3 py-2 text-black focus:outline-none focus:border-black transition-colors";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-white w-full max-w-lg mx-4 flex flex-col max-h-[90vh] overflow-hidden"
        style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}
      >
        <div className="px-6 py-5 border-b border-[#E0E0E0] flex items-center justify-between flex-shrink-0">
          <h2 className="text-black" style={{ fontSize: "0.9375rem", fontWeight: 500 }}>
            {isEdit ? "Edit Plan" : "New Plan"}
          </h2>
          <button onClick={onClose} className="text-black/30 hover:text-black transition-colors">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 px-4 py-3 text-red-700" style={{ fontSize: "0.8125rem" }}>
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: "bappyPlanId" as const, label: "Bappy Plan ID *", placeholder: "e.g. JP_3D_1GB" },
              { key: "name" as const, label: "Plan Name *", placeholder: "e.g. Japan 3 Days 1GB" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block mb-1" style={{ color: "rgba(0,0,0,0.5)", fontSize: "0.6rem" }}>
                  {label}
                </label>
                <input
                  className={inputClass}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  required
                />
              </div>
            ))}
            <div>
              <label className="block mb-1" style={{ color: "rgba(0,0,0,0.5)", fontSize: "0.6rem" }}>
                Plan Type
              </label>
              <select
                className={inputClass}
                value={form.planType}
                onChange={(e) => setForm((f) => ({ ...f, planType: e.target.value as any }))}
              >
                <option value="">(None)</option>
                <option value="initial">initial (新規用)</option>
                <option value="topup">topup (トップアップ用)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block mb-1" style={{ color: "rgba(0,0,0,0.5)", fontSize: "0.6rem" }}>
                Data (GB) *
              </label>
              <input
                className={inputClass}
                value={form.dataGb}
                onChange={(e) => setForm((f) => ({ ...f, dataGb: e.target.value }))}
                placeholder="e.g. 1 or unlimited"
                required
              />
            </div>
            <div>
              <label className="block mb-1" style={{ color: "rgba(0,0,0,0.5)", fontSize: "0.6rem" }}>
                Days *
              </label>
              <input
                className={inputClass}
                type="number"
                min={1}
                value={form.validityDays}
                onChange={(e) => setForm((f) => ({ ...f, validityDays: e.target.value }))}
                placeholder="e.g. 3"
                required
              />
            </div>
            <div>
              <label className="block mb-1" style={{ color: "rgba(0,0,0,0.5)", fontSize: "0.6rem" }}>
                Price (¥) *
              </label>
              <input
                className={inputClass}
                type="number"
                min={1}
                value={form.priceJpy}
                onChange={(e) => setForm((f) => ({ ...f, priceJpy: e.target.value }))}
                placeholder="e.g. 990"
                required
              />
            </div>
            <div>
              <label className="block mb-1" style={{ color: "rgba(0,0,0,0.5)", fontSize: "0.6rem" }}>
                Wholesale ($) 卸
              </label>
              <input
                className={inputClass}
                type="number"
                min={0}
                step="0.01"
                value={form.wholesalePriceUsd}
                onChange={(e) => setForm((f) => ({ ...f, wholesalePriceUsd: e.target.value }))}
                placeholder="e.g. 2.70"
              />
            </div>
          </div>

          <div>
            <label className="block mb-1" style={{ color: "rgba(0,0,0,0.5)", fontSize: "0.6rem" }}>
              Regions (optional)
            </label>
            <input
              className={inputClass}
              value={form.regions}
              onChange={(e) => setForm((f) => ({ ...f, regions: e.target.value }))}
              placeholder='e.g. ["Japan"]'
            />
          </div>
          <div>
            <label className="block mb-1" style={{ color: "rgba(0,0,0,0.5)", fontSize: "0.6rem" }}>
              Sponsor Profile (optional)
            </label>
            <input
              className={inputClass}
              value={form.sponsorProfile}
              onChange={(e) => setForm((f) => ({ ...f, sponsorProfile: e.target.value }))}
              placeholder="e.g. JP_DOCOMO"
            />
          </div>
          <div>
            <label className="block mb-1" style={{ color: "rgba(0,0,0,0.5)", fontSize: "0.6rem" }}>
              Status
            </label>
            <div className="flex gap-3">
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, isActive: v }))}
                  className={`px-4 py-2 border transition-colors ${
                    form.isActive === v ? "border-black bg-black text-white" : "border-[#D7D7D7] text-black/50 hover:border-black/40"
                  }`}
                  style={{ fontSize: "0.6875rem" }}
                >
                  {v ? "Active" : "Inactive"}
                </button>
              ))}
            </div>
          </div>
        </form>

        <div className="px-6 py-4 border-t border-[#E0E0E0] flex gap-3 flex-shrink-0">
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={isPending}
            className="bg-black text-white px-6 py-2.5 hover:bg-black/80 transition-colors disabled:opacity-50"
            style={{ fontSize: "0.6875rem" }}
          >
            {isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Plan"}
          </button>
          <button onClick={onClose} className="text-black/40 hover:text-black transition-colors" style={{ fontSize: "0.6875rem" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// DeleteConfirmDialog
// ─────────────────────────────────────────────
function DeleteConfirmDialog({
  plan,
  onClose,
  onDeleted,
}: {
  plan: PlanRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleDelete = async () => {
    setIsPending(true);
    setDeleteError(null);
    try {
      // 論理削除（Soft Delete）に変更：過去の注文履歴から参照エラーになるのを防ぐため
      await updateDoc(doc(getFirebaseDb(), "plans", plan.id), { isActive: false });
      toast.success("Plan deleted successfully");
      onDeleted();
    } catch (err: any) {
      setDeleteError(err.message || "Failed to delete plan");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full max-w-sm mx-4 p-6" style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
        <h3 className="text-black mb-2" style={{ fontSize: "1rem", fontWeight: 500 }}>
          Delete Plan
        </h3>
        <p className="text-black/60 mb-4" style={{ fontSize: "0.875rem", lineHeight: 1.6 }}>
          <strong style={{ color: "black" }}>{plan.name}</strong> を削除します。この操作は元に戻せません。
        </p>
        {deleteError && (
          <div className="mb-4 bg-red-50 border border-red-200 px-3 py-2">
            <p className="text-red-700" style={{ fontSize: "0.8125rem" }}>
              {deleteError}
            </p>
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="bg-red-600 text-white px-5 py-2 hover:bg-red-700 transition-colors disabled:opacity-50"
            style={{ fontSize: "0.6875rem" }}
          >
            {isPending ? "Deleting..." : "Delete"}
          </button>
          <button onClick={onClose} className="text-black/40 hover:text-black transition-colors" style={{ fontSize: "0.6875rem" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// InlineCell
// ─────────────────────────────────────────────
function InlineCell({
  value,
  planId,
  field,
  type = "text",
  suffix,
  prefix,
  editingCell,
  setEditingCell,
  onSave,
}: {
  value: string | number;
  planId: string;
  field: EditingCell["field"];
  type?: "text" | "number";
  suffix?: string;
  prefix?: string;
  editingCell: EditingCell | null;
  setEditingCell: (c: EditingCell | null) => void;
  onSave: (planId: string, field: EditingCell["field"], value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditing = editingCell?.planId === planId && editingCell?.field === field;
  const [draft, setDraft] = useState(String(value));

  const startEdit = () => {
    setDraft(String(value));
    setEditingCell({ planId, field });
    setTimeout(() => inputRef.current?.select(), 0);
  };
  const commit = () => {
    if (draft.trim() === String(value)) {
      setEditingCell(null);
      return;
    }
    onSave(planId, field, draft.trim());
    setEditingCell(null);
  };
  const cancel = () => {
    setDraft(String(value));
    setEditingCell(null);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
          if (e.key === "Tab") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        autoFocus
        className="w-full border-b border-black bg-transparent outline-none px-0 py-0.5 text-black"
        style={{ fontSize: "0.875rem", minWidth: "60px" }}
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      title="Click to edit"
      className="group flex items-center gap-1 text-left hover:text-black transition-colors cursor-text w-full"
    >
      <span style={{ fontSize: "0.875rem" }}>
        {prefix}
        {type === "number" ? Number(value).toLocaleString() : value}
        {suffix}
      </span>
      <svg
        className="w-3 h-3 text-black/20 group-hover:text-black/50 flex-shrink-0 transition-colors"
        fill="none"
        viewBox="0 0 12 12"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ─────────────────────────────────────────────
// PlansTab (public export)
// ─────────────────────────────────────────────
export function PlansTab() {
  const plansQuery = useMemo(() => query(collection(getFirebaseDb(), "plans")), []);
  const { data: plans = [], isLoading, error: listError } = useFirestoreCollection<any>(() => plansQuery, [plansQuery]);

  // マージン算出用の USD レート（currency_rates: JPY→通貨の乗数）。USD→JPY = usd / rates.USD。
  const ratesQuery = useMemo(
    () => query(collection(getFirebaseDb(), "currency_rates"), orderBy("updatedAt", "desc"), limit(1)),
    [],
  );
  const { data: ratesData = [] } = useFirestoreCollection<{ id: string; rates: Record<string, number> }>(
    () => ratesQuery,
    [ratesQuery],
    { realtime: false },
  );
  const usdPerJpy = ratesData[0]?.rates?.USD ?? null; // 1 JPY = usdPerJpy USD
  const marginInfo = (plan: any): { jpyCost: number; margin: number; pct: number } | null => {
    const usd = plan.wholesalePriceUsd;
    if (usd == null || !usdPerJpy || !plan.priceJpy) return null;
    const jpyCost = usd / usdPerJpy; // 卸USD → JPY
    const margin = plan.priceJpy - jpyCost;
    const pct = plan.priceJpy > 0 ? (margin / plan.priceJpy) * 100 : 0;
    return { jpyCost, margin, pct };
  };

  const [modalPlan, setModalPlan] = useState<PlanRow | null | "new">(
    undefined as unknown as PlanRow | null | "new",
  );
  const [deletePlan, setDeletePlan] = useState<PlanRow | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  // 一回限りの移行用（実行後にこのボタンと Function を削除してよい）
  const [migrating, setMigrating] = useState(false);
  const handleMigrateIsActive = async () => {
    setMigrating(true);
    try {
      const res = await callFunction<undefined, { plansUpdated: number; competitorUpdated: boolean }>(
        CALLABLE.adminMigrateIsActiveToBoolean,
      );
      toast.success(`移行完了: plans ${res.plansUpdated}件 / 比較表 ${res.competitorUpdated ? "更新" : "変更なし"}`);
    } catch (err: any) {
      toast.error(err?.message || "移行に失敗しました");
    } finally {
      setMigrating(false);
    }
  };

  const handleToggle = async (plan: any) => {
    try {
      setToggleError(null);
      const nextActive = !plan.isActive;
      await updateDoc(doc(getFirebaseDb(), "plans", plan.id), {
        isActive: nextActive,
        updatedAt: Date.now(),
      });
      toast.success(`Plan set to ${nextActive ? "Active" : "Inactive"}`);
    } catch (err: any) {
      setToggleError(err.message || "Failed to toggle plan status");
    }
  };

  const handleInlineSave = async (planId: string, field: EditingCell["field"], rawValue: string) => {
    const plan = plans?.find((p: any) => p.id === planId);
    if (!plan) return;
    const patch: any = { updatedAt: Date.now() };
    if (field === "name") patch.name = rawValue;
    if (field === "dataGb") patch.dataGb = rawValue;
    if (field === "validityDays") {
      const v = parseInt(rawValue, 10);
      if (isNaN(v) || v <= 0) {
        toast.error("Invalid days value");
        return;
      }
      patch.validityDays = v;
    }
    if (field === "priceJpy") {
      const v = parseInt(rawValue, 10);
      if (isNaN(v) || v <= 0) {
        toast.error("Invalid price value");
        return;
      }
      patch.priceJpy = v;
    }
    if (field === "wholesalePriceUsd") {
      const v = Number(rawValue);
      if (!Number.isFinite(v) || v < 0) {
        toast.error("Invalid wholesale value");
        return;
      }
      patch.wholesalePriceUsd = v;
    }
    try {
      await updateDoc(doc(getFirebaseDb(), "plans", planId), patch);
      toast.success("Saved inline");
    } catch (err: any) {
      toast.error(err.message || "Failed to save plan inline");
    }
  };

  const handleMove = async (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) return;

    const newRows = [...rows];
    const temp = newRows[index];
    newRows[index] = newRows[targetIndex];
    newRows[targetIndex] = temp;

    try {
      const batch = writeBatch(getFirebaseDb());
      newRows.forEach((plan, idx) => {
        const ref = doc(getFirebaseDb(), "plans", plan.id);
        batch.update(ref, {
          sortOrder: idx * 10,
          updatedAt: Date.now()
        });
      });
      await batch.commit();
      toast.success("Order updated");
    } catch (err: any) {
      toast.error(err.message || "Failed to update order");
    }
  };

  const rows = useMemo(() => {
    if (!plans) return [];
    return [...plans].sort((a: any, b: any) => {
      const aVal = a.sortOrder !== undefined ? a.sortOrder : (a.createdAt || 0);
      const bVal = b.sortOrder !== undefined ? b.sortOrder : (b.createdAt || 0);
      return aVal - bVal;
    });
  }, [plans]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-black" style={{ fontSize: "0.9375rem", fontWeight: 500 }}>
            eSIM Plans
          </p>
          <p className="text-black/40 mt-0.5" style={{ fontSize: "0.8125rem" }}>
            {rows.length} plan{rows.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 一回限りの移行ボタン（文字列 isActive → boolean）。実行後に削除してよい */}
          <button
            onClick={handleMigrateIsActive}
            disabled={migrating}
            className="border border-[#D7D7D7] text-black/60 px-3 py-2 hover:border-black transition-colors disabled:opacity-50"
            style={{ fontSize: "0.6875rem" }}
            title="plans/比較表の isActive を boolean に一括変換（移行用・一度だけ）"
          >
            {migrating ? "Migrating…" : "🔧 Migrate isActive"}
          </button>
          <button
            onClick={() => setModalPlan("new")}
            className="bg-black text-white px-4 py-2 hover:bg-black/80 transition-colors"
            style={{ fontSize: "0.6875rem" }}
          >
            + New Plan
          </button>
        </div>
      </div>

      {toggleError && (
        <div className="mb-4 bg-red-50 border border-red-200 px-4 py-3 flex items-center justify-between">
          <p className="text-red-700" style={{ fontSize: "0.8125rem" }}>
            {toggleError}
          </p>
          <button
            onClick={() => setToggleError(null)}
            className="text-red-400 hover:text-red-600 ml-4"
            style={{ fontSize: "0.6rem" }}
          >
            ✕
          </button>
        </div>
      )}

      {listError ? (
        <div className="py-16 text-center">
          <p className="text-red-500 mb-4" style={{ fontSize: "0.875rem" }}>
            Failed to load plans.
          </p>
        </div>
      ) : isLoading ? (
        <div className="py-16 text-center">
          <p style={{ color: "rgba(0,0,0,0.3)" }}>Loading...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-[#D7D7D7]">
          <p style={{ color: "rgba(0,0,0,0.3)" }}>No plans yet</p>
          <button
            onClick={() => setModalPlan("new")}
            className="mt-4 text-black underline"
            style={{ fontSize: "0.875rem" }}
          >
            Create the first plan
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#E0E0E0]">
                {["ID", "Provider", "Type", "Name", "Data", "Days", "Price (¥)", "Wholesale ($)", "Margin", "Status", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="text-left pb-3 pr-4"
                    style={{ color: "rgba(0,0,0,0.4)", fontSize: "0.6rem" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((plan: any, idx: number) => (
                <tr key={plan.id} className="border-b border-[#F0F0F0] hover:bg-[#F7F7F5] transition-colors">
                  <td className="py-3 pr-4 text-black/40" style={{ fontSize: "0.8125rem" }}>
                    {plan.id}
                  </td>
                  <td className="py-3 pr-4" style={{ minWidth: "110px" }}>
                    <span
                      className={`inline-block px-1.5 py-0.5 border text-[0.55rem] font-medium tracking-wider uppercase ${
                        (plan.provider ?? "bappy") === "esimaccess"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-gray-100 text-gray-500 border-gray-200"
                      }`}
                    >
                      {plan.provider ?? "bappy"}
                    </span>
                    <div className="text-black/40 font-mono mt-0.5" style={{ fontSize: "0.65rem" }}>
                      {plan.providerPlanId ?? plan.bappyPlanId}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-black/60" style={{ fontSize: "0.75rem" }}>
                    {plan.planType || "-"}
                  </td>
                  <td className="py-3 pr-4" style={{ fontWeight: 500, minWidth: "120px" }}>
                    <InlineCell
                      value={plan.name}
                      planId={plan.id}
                      field="name"
                      editingCell={editingCell}
                      setEditingCell={setEditingCell}
                      onSave={handleInlineSave}
                    />
                    {(plan.network || plan.ipExport) && (
                      <div className="text-black/35 mt-0.5" style={{ fontSize: "0.65rem" }}>
                        {plan.network}
                        {plan.network && plan.ipExport ? " · " : ""}
                        {plan.ipExport ? `IP:${plan.ipExport}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4" style={{ minWidth: "70px" }}>
                    <InlineCell
                      value={plan.dataGb}
                      planId={plan.id}
                      field="dataGb"
                      suffix=" GB"
                      editingCell={editingCell}
                      setEditingCell={setEditingCell}
                      onSave={handleInlineSave}
                    />
                  </td>
                  <td className="py-3 pr-4" style={{ minWidth: "60px" }}>
                    <InlineCell
                      value={plan.validityDays}
                      planId={plan.id}
                      field="validityDays"
                      type="number"
                      suffix="d"
                      editingCell={editingCell}
                      setEditingCell={setEditingCell}
                      onSave={handleInlineSave}
                    />
                  </td>
                  <td className="py-3 pr-4" style={{ fontWeight: 500, minWidth: "80px" }}>
                    <InlineCell
                      value={plan.priceJpy}
                      planId={plan.id}
                      field="priceJpy"
                      type="number"
                      prefix="¥"
                      editingCell={editingCell}
                      setEditingCell={setEditingCell}
                      onSave={handleInlineSave}
                    />
                  </td>
                  <td className="py-3 pr-4 text-black/60" style={{ minWidth: "80px" }}>
                    {plan.wholesalePriceUsd != null ? (
                      <InlineCell
                        value={plan.wholesalePriceUsd}
                        planId={plan.id}
                        field="wholesalePriceUsd"
                        type="number"
                        prefix="$"
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        onSave={handleInlineSave}
                      />
                    ) : (
                      <span className="text-black/25" style={{ fontSize: "0.8125rem" }}>—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4" style={{ minWidth: "90px" }}>
                    {(() => {
                      const m = marginInfo(plan);
                      if (!m) return <span className="text-black/25" style={{ fontSize: "0.8125rem" }}>—</span>;
                      const positive = m.margin >= 0;
                      return (
                        <span
                          title={`卸 ≈ ¥${Math.round(m.jpyCost).toLocaleString()}（レート換算）`}
                          style={{ fontSize: "0.8125rem", color: positive ? "#15803d" : "#dc2626", fontWeight: 500 }}
                        >
                          ¥{Math.round(m.margin).toLocaleString()}
                          <span style={{ fontSize: "0.65rem", opacity: 0.7 }}> ({m.pct.toFixed(0)}%)</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-3 pr-4">
                    <button
                      onClick={() => handleToggle(plan)}
                      className={`px-2.5 py-1 border text-[0.6rem] font-medium tracking-wider uppercase transition-colors ${
                        plan.isActive
                          ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                          : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"
                      }`}
                    >
                      {plan.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleMove(idx, "up")}
                        disabled={idx === 0}
                        className="text-black/40 hover:text-black transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                        style={{ fontSize: "0.6rem" }}
                        title="Move Up"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => handleMove(idx, "down")}
                        disabled={idx === rows.length - 1}
                        className="text-black/40 hover:text-black transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                        style={{ fontSize: "0.6rem" }}
                        title="Move Down"
                      >
                        ▼
                      </button>
                      <button
                        onClick={() => setModalPlan(plan as PlanRow)}
                        className="text-black/40 hover:text-black transition-colors"
                        style={{ fontSize: "0.6rem" }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeletePlan(plan as PlanRow)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        style={{ fontSize: "0.6rem" }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalPlan !== undefined && (
        <PlanFormModal
          plan={modalPlan === "new" ? null : modalPlan}
          onClose={() => setModalPlan(undefined as unknown as PlanRow | null | "new")}
          onSaved={() => setModalPlan(undefined as unknown as PlanRow | null | "new")}
        />
      )}
      {deletePlan && (
        <DeleteConfirmDialog
          plan={deletePlan}
          onClose={() => setDeletePlan(null)}
          onDeleted={() => setDeletePlan(null)}
        />
      )}
    </div>
  );
}
