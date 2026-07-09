import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { activeInitialPlansQuery, latestCurrencyRatesQuery } from "@/lib/queries";
import { useFirestoreCollection } from "@/hooks/useFirestoreCollection";
import { trackEvent } from "@/lib/analytics";
import FadeIn from "./FadeIn";
import { FsPlan } from "../../../../shared/types";
import {
  type FlatPlanOption,
  groupPlansByDays,
  flattenPlanOptions,
  serif,
} from "./types";

interface PlansSectionProps {
  onSelectPlan: (days: number, gb: string, priceJpy: number, bappyPlanId?: string) => void;
}

/**
 * PlansSection — 全プランをフラットな1リストで提示（plan-selector改修）。
 * 旧「Step1 日数 → Step2 容量」の2段選択を廃止。日数は「最長◯日利用可」の上限属性として
 * 各カードに表示する（validityDays は旅程との一致条件ではないため）。
 */
export default function PlansSection({ onSelectPlan }: PlansSectionProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<FlatPlanOption | null>(null);
  const [currency, setCurrency] = useState<string>("JPY");
  const AVAILABLE_CURRENCIES = ["JPY", "USD", "EUR", "TWD", "KRW", "THB", "SGD", "GBP", "CNY"];

  // BaaS ネイティブ: Callable Function を廃止し Firestore 直接購読に移行（AP-04）
  const plansQuery = useMemo(
    // 初期購入プランのみ（topup を除外）。クエリ本体は lib/queries.ts に集約（P4-1）
    () => activeInitialPlansQuery(),
    []
  );
  const { data: dbPlans = [] } = useFirestoreCollection<FsPlan>(
    () => plansQuery,
    [plansQuery],
    { realtime: false }
  );
  const ratesQuery = useMemo(() => latestCurrencyRatesQuery(), []);
  const { data: ratesData } = useFirestoreCollection<{ id: string; rates: Record<string, number>; updatedAt: number }>(
    () => ratesQuery,
    [ratesQuery],
    { realtime: false }
  );
  const rates = ratesData[0]?.rates ?? null;
  const flatPlans = useMemo(
    () => flattenPlanOptions(groupPlansByDays(dbPlans as FsPlan[])),
    [dbPlans]
  );

  const handleSelect = (p: FlatPlanOption) => {
    setSelected(p);
    trackEvent("plan_card_click", { days: p.days, gb: p.gb });
  };

  const formatPrice = (priceJpy: number) => {
    if (currency === "JPY" || !rates || !rates[currency]) {
      return `¥${priceJpy.toLocaleString()}`;
    }
    const rate = rates[currency];
    const converted = priceJpy * rate;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: ["KRW", "TWD"].includes(currency) ? 0 : 2,
    }).format(converted);
  };

  return (
    <section id="plans" className="py-24 lg:py-36 bg-[#F7F7F7]">
      <div className="container">
        <FadeIn>
          <p className="text-label text-black/35 mb-3">{t("plans.sectionLabel")}</p>
          <h2 className="text-black" style={serif("clamp(2.25rem, 4.5vw, 3.75rem)")}>{t("plans.title")}</h2>
          <p className="font-sans text-black/50 mt-4 max-w-md text-[0.9375rem] leading-[1.7]">
            {t("plans.subtitle")}
          </p>
        </FadeIn>

        {/* 全プランのフラットリスト（価格昇順） */}
        <FadeIn delay={0.1}>
          <div className="mt-14">
            <p className="text-label text-black/35 mb-4 text-[0.6875rem]">{t("plans.allPlans")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-[#D7D7D7]">
              {flatPlans.map((opt) => (
                <motion.button
                  key={opt.planId}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleSelect(opt)}
                  className={`relative bg-white p-6 text-left transition-colors duration-150 ${
                    selected?.planId === opt.planId ? "ring-2 ring-black ring-inset" : "hover:bg-[#F0F0F0]"
                  }`}
                >
                  {opt.popular && (
                    <p className="font-sans font-medium text-black/40 mb-2 text-[0.6rem] tracking-[0.22em] uppercase">{t("plans.popular")}</p>
                  )}
                  <p className="font-sans font-light text-black text-[clamp(1.5rem,3vw,2rem)] leading-[1.1] tracking-[-0.02em]">
                    {opt.gb}
                  </p>
                  <p className="font-sans text-black/40 mt-1 text-[0.75rem]">{t("plans.validUpTo", { days: opt.days })}</p>
                  <p className="font-sans font-medium text-black mt-2 text-[1.4rem] tracking-[-0.01em]">{formatPrice(opt.priceJpy)}</p>
                  {selected?.planId === opt.planId && (
                    <motion.div
                      layoutId="gb-check"
                      className="absolute top-3 right-3 w-5 h-5 bg-black flex items-center justify-center"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <polyline points="1.5 5 4 7.5 8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </motion.div>
                  )}
                </motion.button>
              ))}
            </div>
            <p className="font-sans text-black/35 mt-4 text-[0.75rem] leading-[1.6]">{t("plans.usageHint")}</p>
          </div>
        </FadeIn>

        {/* 価格表示 + 通貨切り替え */}
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
              className="mt-10"
            >
              <FadeIn>
                <div className="bg-white border border-[#D7D7D7] p-8">
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
                    <div>
                      <p className="text-label text-black/35 mb-2">
                        {selected.gb} · {t("plans.validUpTo", { days: selected.days })}
                      </p>
                      <motion.p
                        key={`${currency}-${selected.priceJpy}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                        className="text-black"
                        style={serif("clamp(2.5rem, 6vw, 4rem)")}
                      >
                        {formatPrice(selected.priceJpy)}
                      </motion.p>
                      <div className="flex gap-2 mt-4 flex-wrap">
                        {AVAILABLE_CURRENCIES.map((c) => (
                          <button
                            key={c}
                            onClick={() => setCurrency(c)}
                            className={`font-sans font-medium text-[10px] tracking-[0.14em] uppercase px-3 py-1.5 border transition-colors duration-150 ${
                              currency === c ? "bg-black text-white border-black" : "bg-white text-black/50 border-[#D7D7D7] hover:border-black/50"
                            }`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                      {currency !== "JPY" && (
                        <p className="font-sans mt-2 text-black/30 text-[0.6875rem]">
                          {t("plans.approxRate")}
                        </p>
                      )}
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => onSelectPlan(selected.days, selected.gb, selected.priceJpy, selected.bappyPlanId)}
                      className="text-label text-[0.75rem] bg-black text-white px-10 py-4 hover:bg-black/80 transition-colors duration-200 whitespace-nowrap"
                    >
                      {t("plans.buyCta")}
                    </motion.button>
                  </div>
                </div>
              </FadeIn>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
