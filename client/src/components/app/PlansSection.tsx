import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { collection, query, where, orderBy, limit } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useFirestoreCollection } from "@/hooks/useFirestoreCollection";
import FadeIn from "./FadeIn";
import { FsPlan } from "../../../../shared/types";
import {
  getPlanDays,
  type PlanOption,
  groupPlansByDays,
  serif,
} from "./types";

interface PlansSectionProps {
  onSelectPlan: (days: number, gb: string, priceJpy: number, bappyPlanId?: string) => void;
}

export default function PlansSection({ onSelectPlan }: PlansSectionProps) {
  const { t } = useTranslation();
  const [selectedDays, setSelectedDays] = useState<number>(7);
  const [selectedGb, setSelectedGb] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>("JPY");
  const AVAILABLE_CURRENCIES = ["JPY", "USD", "EUR", "TWD", "KRW", "THB", "SGD", "GBP", "CNY"];

  // BaaS ネイティブ: Callable Function を廃止し Firestore 直接購読に移行（AP-04）
  const plansQuery = useMemo(
    // 初期購入プランのみ（topup を除外）。planType は本番で全プランに設定済み
    () => query(collection(getFirebaseDb(), "plans"), where("isActive", "==", true), where("planType", "==", "initial")),
    []
  );
  const { data: dbPlans = [] } = useFirestoreCollection<FsPlan>(
    () => plansQuery,
    [plansQuery],
    { realtime: false }
  );
  const ratesQuery = useMemo(
    () => query(collection(getFirebaseDb(), "currency_rates"), orderBy("updatedAt", "desc"), limit(1)),
    []
  );
  const { data: ratesData } = useFirestoreCollection<{ id: string; rates: Record<string, number>; updatedAt: number }>(
    () => ratesQuery,
    [ratesQuery],
    { realtime: false }
  );
  const rates = ratesData[0]?.rates ?? null;
  const planDays = getPlanDays(dbPlans as FsPlan[]);
  const planOptions = groupPlansByDays(dbPlans as FsPlan[]);
  const gbOptions: PlanOption[] = planOptions[selectedDays] ?? [];

  const handleDaySelect = (d: number) => { setSelectedDays(d); setSelectedGb(null); };

  const selectedOption = gbOptions.find((o) => o.gb === selectedGb);

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

        {/* Step 1: 日数選択 */}
        <FadeIn delay={0.1}>
          <div className="mt-14">
            <p className="text-label text-black/35 mb-4 text-[0.6875rem]">{t("plans.step1")}</p>
            <div className="flex flex-wrap gap-3">
              {planDays.map((d) => (
                <motion.button
                  key={d}
                  onClick={() => handleDaySelect(d)}
                  whileTap={{ scale: 0.96 }}
                  className={`font-sans font-light px-6 py-3 border transition-colors duration-200 text-[clamp(1.1rem,2.5vw,1.5rem)] tracking-[-0.01em] ${
                    selectedDays === d ? "bg-black text-white border-black" : "bg-white text-black border-[#D7D7D7] hover:border-black"
                  }`}
                >
                  {t("plans.days", { days: d })}
                </motion.button>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Step 2: GB選択 */}
        <FadeIn delay={0.15}>
          <div className="mt-10">
            <p className="text-label text-black/35 mb-4 text-[0.6875rem]">{t("plans.step2")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#D7D7D7]">
              <AnimatePresence>
                {gbOptions.map((opt, i) => (
                  <motion.button
                    key={`${selectedDays}-${opt.gb}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, delay: i * 0.05, ease: [0.23, 1, 0.32, 1] }}
                    onClick={() => setSelectedGb(opt.gb)}
                    className={`relative bg-white p-6 text-left transition-colors duration-150 ${
                      selectedGb === opt.gb ? "ring-2 ring-black ring-inset" : "hover:bg-[#F0F0F0]"
                    }`}
                  >
                    {opt.popular && (
                      <p className="font-sans font-medium text-black/40 mb-2 text-[0.6rem] tracking-[0.22em] uppercase">{t("plans.popular")}</p>
                    )}
                    <p className="font-sans font-light text-black text-[clamp(1.5rem,3vw,2rem)] leading-[1.1] tracking-[-0.02em]">
                      {opt.gb}
                    </p>
                    {selectedGb === opt.gb && (
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
              </AnimatePresence>
            </div>
          </div>
        </FadeIn>

        {/* Step 3: 価格表示 + 通貨切り替え */}
        <AnimatePresence>
          {selectedGb && selectedOption && (
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
                        {t("plans.days", { days: selectedDays })} / {selectedGb}
                      </p>
                      <motion.p
                        key={`${currency}-${selectedOption.priceJpy}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                        className="text-black"
                        style={serif("clamp(2.5rem, 6vw, 4rem)")}
                      >
                        {formatPrice(selectedOption.priceJpy)}
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
                      onClick={() => onSelectPlan(selectedDays, selectedGb, selectedOption.priceJpy, selectedOption.bappyPlanId)}
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
