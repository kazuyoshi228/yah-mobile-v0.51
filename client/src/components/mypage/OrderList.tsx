import { getFirebaseDb } from "@/lib/firebase";
import { callFunction, CALLABLE } from "@/lib/callable";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { doc, updateDoc } from "firebase/firestore";
import { motion } from "framer-motion";
import { useState, useCallback } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import type { OrderRow, EsimPreview, EsimPreviewMap } from "./types";

function OrderCard({
  order,
  esimPreview,
  onClick,
  onHide,
}: {
  order: OrderRow;
  esimPreview?: EsimPreview;
  onClick: () => void;
  onHide: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [confirmHide, setConfirmHide] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetryPayment = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRetrying(true);
    try {
      const result = await callFunction<{ orderId: string; origin: string }, { checkoutUrl: string }>(
        CALLABLE.orderRetryPayment,
        { orderId: order.id, origin: window.location.origin }
      );
      toast("Redirecting to payment...");
      window.location.href = result.checkoutUrl;
    } catch (err: any) {
      toast.error(t("common.paymentFailed"));
    } finally {
      setIsRetrying(false);
    }
  };
  const date = new Date(order.createdAt).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  const expiryDisplay = esimPreview?.expiryDate
    ? new Date(esimPreview.expiryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const pct = esimPreview?.dataTotalMb && esimPreview.dataRemainingMb != null
    ? Math.min(100, Math.round((esimPreview.dataRemainingMb / esimPreview.dataTotalMb) * 100))
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-black/10 p-5 sm:p-6 cursor-pointer hover:border-black/30 transition-colors duration-200 group active:scale-[0.99]"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <p className="font-sans font-medium text-black text-[0.9375rem]">{order.planName ?? "Japan eSIM"}</p>
            <StatusBadge status={order.status} />
          </div>
          <p className="font-sans text-black/30 text-xs">{date}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-sans font-medium text-black">¥{order.amountJpy?.toLocaleString()}</p>
        </div>
      </div>

      {/* eSIMプレビュー（fulfilled状態のみ） */}
      {order.status === "fulfilled" && pct !== null && (
        <div className="mt-4 pt-4 border-t border-black/5">
          <div className="flex items-center justify-between mb-1">
            <span className="font-sans text-black/30 text-xs">Data</span>
            <span className="font-sans text-black/50 text-xs">{pct}% remaining</span>
          </div>
          <div className="w-full h-1 bg-black/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${pct > 50 ? "bg-black/40" : pct > 20 ? "bg-amber-400" : "bg-red-400"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {expiryDisplay && (
            <p className="font-sans text-black/25 text-xs mt-1.5">Expires {expiryDisplay}</p>
          )}
        </div>
      )}

      {/* pending注文の再決済ボタン */}
      {order.status === "pending" && (
        <div className="mt-4 pt-4 border-t border-black/5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handleRetryPayment}
            disabled={isRetrying}
            className="w-full text-label text-[0.7rem] inline-flex items-center justify-center gap-2 bg-black text-white px-5 py-3 hover:bg-black/80 transition-colors duration-200 active:scale-[0.97] disabled:opacity-50"
          >
            {isRetrying ? (
              <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />Processing…</>
            ) : (
              <>Complete Payment →</>
            )}
          </button>
          <p className="font-sans text-black/30 text-xs mt-2 text-center">Your order is waiting for payment.</p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1 text-black/30 group-hover:text-black/60 transition-colors duration-200">
          <span className="text-label text-[0.625rem]">View details</span>
          <span className="text-xs">→</span>
        </div>
        {/* 削除ボタン（済み・失敗・キャンセル注文のみ表示） */}
        {["pending", "paid", "cancelled", "failed", "refunded", "fulfilled"].includes(order.status) && (
          confirmHide ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <span className="font-sans text-black/40 text-[0.625rem]">Remove?</span>
              <button
                onClick={() => onHide(order.id)}
                className="text-label text-[0.625rem] text-red-500 hover:text-red-700 transition-colors duration-150 px-2 py-1"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmHide(false)}
                className="text-label text-[0.625rem] text-black/30 hover:text-black/60 transition-colors duration-150 px-2 py-1"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmHide(true); }}
              className="text-label text-[0.625rem] text-black/20 hover:text-black/50 transition-colors duration-150 px-2 py-1 opacity-0 group-hover:opacity-100"
              aria-label="Remove from history"
            >
              Remove
            </button>
          )
        )}
      </div>
    </motion.div>
  );
}

export function OrderList({
  orders,
  onSelect,
  esimByOrderId,
}: {
  orders: OrderRow[];
  onSelect: (id: string) => void;
  esimByOrderId: EsimPreviewMap;
}) {
  // BaaSネイティブ: ordersHide Callable を廃止し Firestore 直接 updateDoc に移行
  const handleHideOrder = useCallback(async (id: string) => {
    await updateDoc(doc(getFirebaseDb(), "orders", id), {
      hiddenByUser: true,
      updatedAt: Date.now(),
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {orders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          esimPreview={esimByOrderId.get(order.id) as EsimPreview ?? null}
          onClick={() => onSelect(order.id)}
          onHide={handleHideOrder}
        />
      ))}
    </div>
  );
}
