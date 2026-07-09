import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DrawerClose } from "@/components/ui/drawer";
import { usePurchaseFlow } from "../context";
import { flattenPlanOptions } from "../../types";

/**
 * Step0Plan — 全プランをフラットな1リストで提示する統合ステップ。
 * 旧 Step0Duration（日数選択）＋ Step1Data（容量選択）を置き換え（plan-selector改修）。
 * 日数は選択条件ではなく「最長◯日利用可」という上限属性として各カードに表示する。
 */
export function Step0Plan() {
  const { t } = useTranslation();
  const { lastPlanOpt, planOptions, setDrawerDays, setDrawerGb, setStep } = usePurchaseFlow();
  const flatPlans = useMemo(() => flattenPlanOptions(planOptions), [planOptions]);

  return (
    <div>
      <p className="text-label text-black/35 mb-2">{t("drawer.stepOf", { current: 1, total: 2 })}</p>
      <h2 className="font-sans font-light text-black mb-2 text-[1.375rem] leading-[1.15] tracking-[-0.02em]">{t("drawer.planTitle")}</h2>
      <p className="font-sans text-black/50 mb-8 text-[0.875rem] leading-[1.7]">{t("drawer.planDesc")}</p>

      {lastPlanOpt && (
        <div className="mb-8 p-5 border border-black bg-black text-white">
          <p className="text-label text-white/50 mb-3" style={{ fontSize: "0.6875rem", letterSpacing: "0.15em" }}>
            ★ {t("drawer.previousPlan", "前回と同じプランを再購入")}
          </p>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-sans font-medium text-[1.25rem]">
                {lastPlanOpt.days} {t("drawer.days")} / {lastPlanOpt.opt.gb}
              </p>
            </div>
            <button
              onClick={() => {
                setDrawerDays(lastPlanOpt.days);
                setDrawerGb(lastPlanOpt.opt.gb);
                setStep(1);
              }}
              className="text-label px-5 py-2.5 bg-white text-black hover:bg-[#F7F7F7] transition-colors"
            >
              {t("drawer.buyAgain", "再購入")}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px bg-[#D7D7D7] mb-3">
        {flatPlans.map((p) => (
          <button
            key={p.planId}
            onClick={() => { setDrawerDays(p.days); setDrawerGb(p.gb); setStep(1); }}
            className="relative text-left bg-white p-5 transition-colors duration-150 hover:bg-[#F7F7F7] active:scale-[0.98] flex flex-col items-start"
          >
            {/* POPULAR はカード左上に重ねる外出しバッジ（全カードの行を揃える） */}
            {p.popular && (
              <p className="absolute top-0 left-0 bg-black text-white font-sans font-medium px-2 py-1 text-[0.55rem] tracking-[0.18em] uppercase">{t("drawer.popular")}</p>
            )}
            <p className="font-sans font-light text-black text-[1.5rem] tracking-[-0.02em]">{p.gb}</p>
            <p className="font-sans text-black/40 mt-0.5 text-[0.75rem]">{t("plans.validUpTo", { days: p.days })}</p>
            {/* 価格は下端アンカー（行数差でも価格行が揃う） */}
            <p className="font-sans font-medium text-black mt-auto pt-2 text-[1.4rem] tracking-[-0.01em]">¥{p.priceJpy.toLocaleString()}</p>
          </button>
        ))}
      </div>
      <p className="font-sans text-black/35 mb-8 text-[0.75rem] leading-[1.6]">{t("plans.usageHint")}</p>
      <DrawerClose asChild><button className="text-label px-5 py-3.5 border border-[#D7D7D7] text-black hover:border-black transition-colors">{t("drawer.back")}</button></DrawerClose>
    </div>
  );
}
