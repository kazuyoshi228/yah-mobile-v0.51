/*
 * AppPage.tsx — yah.mobile Landing Page
 * Brand: White/Black/Gray palette, National2 Medium (titles) + National2 Regular (copy)
 * Style: Full-bleed hero, large typography, generous whitespace
 * Reference: vaangroup.com — editorial, bold, minimal
 */
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent, trackPageView } from "@/lib/analytics";
import { motion, AnimatePresence } from "framer-motion";
import { Plane, Signal, MessageCircle, Zap, BarChart2, UserCircle, Tag, type LucideIcon } from "lucide-react";
import Nav from "@/components/Nav";
import { useIsMobile } from "@/hooks/useMobile";
import Footer from "@/components/Footer";
import { ASSETS } from "@/lib/assets";
import { collection, query, where, orderBy } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useFirestoreCollection } from "@/hooks/useFirestoreCollection";
import {
  FadeIn,
  serif,
} from "@/components/app";
import type { FsPlan } from "../../../shared/types";

// Lazy-loaded heavy components (Below the fold)
const PurchaseDrawer = lazy(() => import("@/components/app/PurchaseDrawer"));
const HowItWorksSection = lazy(() => import("@/components/app/HowItWorksSection"));
const PlansSection = lazy(() => import("@/components/app/PlansSection"));
const LegalSection = lazy(() => import("@/components/app/LegalSection"));
const ComparisonTable = lazy(() => import("@/components/app/ComparisonTable"));
const ContactSection = lazy(() => import("@/components/app/ContactSection"));
const DeviceChecker = lazy(() => import("@/components/app/DeviceChecker"));
const ReferenceAccordion = lazy(() => import("@/components/app/ReferenceAccordion"));

const FEATURE_ICONS: Record<string, LucideIcon> = {
  Plane, Signal, MessageCircle, Zap, BarChart2, UserCircle, Tag,
};

const FEATURE_KEYS = [
  { icon: "Tag", key: "bestPrice" },
  { icon: "Signal", key: "coverage" },
  { icon: "MessageCircle", key: "support" },
  { icon: "Zap", key: "activation" },
  { icon: "BarChart2", key: "tracking" },
  { icon: "UserCircle", key: "account" },
] as const;

// HERO background: MP4 video loop (desktop) / WebP image + lazy video (mobile)
const HERO_VIDEO = ASSETS.HERO_VIDEO;
const HERO_MOBILE_VIDEO = ASSETS.HERO_MOBILE_VIDEO;
const HERO_MOBILE_IMG = ASSETS.HERO_MOBILE_IMG;
const CITY_IMG = ASSETS.CITY_IMG;
const NATURE_IMG = ASSETS.NATURE_IMG;

export default function AppPage() {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPlanId, setDrawerPlanId] = useState<string | undefined>(undefined);
  // プラン選択の引き継ぎ用（PlansSection選択／ログイン往復のURLパラメータから復元）
  const [drawerInitialDays, setDrawerInitialDays] = useState<number | undefined>(undefined);
  const [drawerInitialGb, setDrawerInitialGb] = useState<string | undefined>(undefined);
  const [drawerInitialStep, setDrawerInitialStep] = useState<number | undefined>(undefined);
  const [drawerOrderId, setDrawerOrderId] = useState<string | undefined>(undefined);

  // モバイルHERO動画: LCPを守るため画像を先に表示し、初回描画後に動画を遅延ロード→再生可能でフェードイン
  const [loadMobileVideo, setLoadMobileVideo] = useState(false);
  const [mobileVideoReady, setMobileVideoReady] = useState(false);
  useEffect(() => {
    if (!isMobile) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // モーション抑制時は画像のまま
    const start = () => setLoadMobileVideo(true);
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) {
      const id = ric(start, { timeout: 2000 });
      return () => (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const tid = window.setTimeout(start, 1200);
    return () => window.clearTimeout(tid);
  }, [isMobile]);

  // JSON-LD Product Schema 用 — BaaSネイティブ: plansList Callable Function を廃止し Firestore 直接参照に移行（AP-04）
  const allPlansQuery = useMemo(
    // 初期購入プランのみ（topup を除外）。planType は本番で全プランに設定済み
    () => query(collection(getFirebaseDb(), "plans"), where("isActive", "==", true), where("planType", "==", "initial")),
    []
  );
  const { data: allDbPlans = [] } = useFirestoreCollection<FsPlan>(() => allPlansQuery, [allPlansQuery], { realtime: false });

  // Parse ?buy=planId&step=N to open PurchaseDrawer directly
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const buyPlan = params.get("buy");
    const step = params.get("step");
    if (buyPlan) {
      setDrawerPlanId(buyPlan);
      if (step) setDrawerInitialStep(parseInt(step, 10));
      setDrawerOpen(true);
      
      // Clean up URL so it doesn't reopen on reload
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  // SEO meta tags
  useEffect(() => {
    const lang = i18n.language ?? "en";
    const htmlEl = document.documentElement;
    htmlEl.setAttribute("lang", lang);

    // Title
    document.title = t("seo.title", "yah.mobile — Japan eSIM for Travelers | From ¥990");

    // Meta description
    let metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.name = "description";
      document.head.appendChild(metaDesc);
    }
    metaDesc.content = t("seo.description");

    // Meta keywords
    let metaKw = document.querySelector<HTMLMetaElement>('meta[name="keywords"]');
    if (!metaKw) {
      metaKw = document.createElement("meta");
      metaKw.name = "keywords";
      document.head.appendChild(metaKw);
    }
    metaKw.content = t("seo.keywords");

    // Canonical
    const canonicalUrl = i18n.language === "ko" ? "https://yah.mobi/ko/app"
      : i18n.language === "zh-CN" ? "https://yah.mobi/zh-CN/app"
      : "https://yah.mobi/app";
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;

    // hreflang alternates
    document.querySelectorAll('link[rel="alternate"][hreflang]').forEach(el => el.remove());
    const hreflangs = [
      { hreflang: "en", href: "https://yah.mobi/app" },
      { hreflang: "zh-CN", href: "https://yah.mobi/zh-CN/app" },
      { hreflang: "zh-Hans", href: "https://yah.mobi/zh-CN/app" },
      { hreflang: "ko", href: "https://yah.mobi/ko/app" },
      { hreflang: "x-default", href: "https://yah.mobi/app" },
    ];
    hreflangs.forEach(({ hreflang, href }) => {
      const link = document.createElement("link");
      link.rel = "alternate";
      link.setAttribute("hreflang", hreflang);
      link.href = href;
      document.head.appendChild(link);
    });

    // OG tags
    const ogTags: Record<string, string> = {
      "og:title": t("seo.ogTitle"),
      "og:description": t("seo.ogDescription"),
      "og:url": canonicalUrl,
      "og:locale": lang === "ko" ? "ko_KR" : lang === "zh-CN" ? "zh_CN" : lang === "zh-TW" ? "zh_TW" : "en_US",
    };
    Object.entries(ogTags).forEach(([property, content]) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.content = content;
    });

    return () => {
      // Cleanup hreflang on unmount
      document.querySelectorAll('link[rel="alternate"][hreflang]').forEach(el => el.remove());
    };
  }, [i18n.language, t]);

  // ページビュートラッキング
  useEffect(() => {
    trackPageView(i18n.language === "en" ? "/app" : `/${i18n.language}/app`);
  }, [i18n.language]);

  // URLParam処理：?plan=JP_7D_3GB&open=true
  useEffect(() => {
    const handleOpenParam = () => {
      const params = new URLSearchParams(window.location.search);
      const planParam = params.get("plan");
      const openParam = params.get("open");
      const paymentParam = params.get("payment");
      if (paymentParam === "complete") {
        // Stripe Embedded Checkoutの返り先：eSIM表示画面を表示
        const orderIdParam = params.get("orderId");
        trackEvent("order_complete", { orderId: orderIdParam ?? undefined });
        if (orderIdParam) setDrawerOrderId(orderIdParam);
        setDrawerInitialStep(6);
        setDrawerOpen(true);
        window.history.replaceState(null, "", window.location.pathname + window.location.hash);
      } else if (planParam || openParam === "true") {
        if (planParam) setDrawerPlanId(planParam);
        // days / gb を URL から直接復元（Firestore 読み込み前でも即時反映）
        const daysParam = params.get("days");
        const gbParam = params.get("gb");
        if (daysParam) setDrawerInitialDays(parseInt(daysParam, 10));
        if (gbParam) setDrawerInitialGb(gbParam);
        setDrawerInitialStep(undefined);
        setDrawerOpen(true);
        window.history.replaceState(null, "", window.location.pathname + window.location.hash);
      }
    };
    handleOpenParam();
    // NavのBUYボタンからpopstateイベントでも履行
    window.addEventListener("popstate", handleOpenParam, { passive: true });
    return () => window.removeEventListener("popstate", handleOpenParam);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ハッシュ付き遷移時のスクロール
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: "smooth" });
        window.history.replaceState(null, "", window.location.pathname);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  // JSON-LD 構造化データ（FAQPage + Product + AggregateRating + Review）
  useEffect(() => {
    const lang = i18n.language ?? "en";

    // FAQPage schema
    const faqItems = t("faq.items", { returnObjects: true }) as Array<{ q: string; a: string }>;
    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "inLanguage": lang,
      "mainEntity": faqItems.map((f) => ({
        "@type": "Question",
        "name": f.q,
        "acceptedAnswer": { "@type": "Answer", "text": f.a },
      })),
    };
    const faqScript = Object.assign(document.createElement("script"), {
      type: "application/ld+json",
      id: "schema-faq",
      textContent: JSON.stringify(faqSchema),
    });
    document.getElementById("schema-faq")?.remove();
    document.head.appendChild(faqScript);

    const pageUrl = lang === "ko" ? "https://yah.mobi/app/ko"
      : lang === "zh-CN" ? "https://yah.mobi/app/zh"
      : "https://yah.mobi/app";

    // Product schema with AggregateRating + Review + Offer
    const productName = lang === "ko" ? "yah.mobile 일본 eSIM"
      : lang === "zh-CN" ? "yah.mobile 日本eSIM"
      : "yah.mobile Japan eSIM";
    const productDesc = lang === "ko"
      ? "일본 여행자를 위한 eSIM 서비스. QR 코드 즉시 발급, KDDI 네트워크. ¥990부터."
      : lang === "zh-CN"
      ? "面向赴日旅行者的eSIM服务。即时发送二维码，KDDI网络。低至¥990。"
      : "Japan eSIM for international travelers. Instant QR code delivery, KDDI network. Plans from ¥990.";

    const reviewItems = [
      { author: "Sarah M.", rating: 5, body: lang === "ko" ? "공항에서 바로 연결됐어요. 완벽했습니다!" : lang === "zh-CN" ? "落地即连，完美！" : "Connected the moment I landed. Absolutely seamless!" },
      { author: "Lucas B.", rating: 5, body: lang === "ko" ? "설정이 너무 쉬웠어요. 일본 전역에서 빠른 속도!" : lang === "zh-CN" ? "设置超简单，全日本网速都很快！" : "Setup took 2 minutes. Fast everywhere in Japan." },
      { author: "Yuki T.", rating: 5, body: lang === "ko" ? "교토와 오사카에서 완벽하게 작동했어요." : lang === "zh-CN" ? "京都和大阪都完美运行。" : "Worked perfectly in Kyoto and Osaka. Great value." },
    ];

    const minPrice = (allDbPlans as (FsPlan & { description?: string | null })[]).reduce(
      (min, p) => (p.priceJpy < min ? p.priceJpy : min),
      Infinity
    );

    const productSchema = {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": productName,
      "description": productDesc,
      "url": pageUrl,
      "image": "https://yah.mobi/og-image.png",
      "brand": { "@type": "Brand", "name": "yah.mobile" },
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "5.0",
        "reviewCount": "3",
        "bestRating": "5",
        "worstRating": "1",
      },
      "review": reviewItems.map((r) => ({
        "@type": "Review",
        "author": { "@type": "Person", "name": r.author },
        "reviewRating": { "@type": "Rating", "ratingValue": String(r.rating), "bestRating": "5" },
        "reviewBody": r.body,
      })),
      "offers": (allDbPlans as (FsPlan & { description?: string | null })[]).length > 0
        ? {
            "@type": "AggregateOffer",
            "lowPrice": String(Math.min(...(allDbPlans as FsPlan[]).map(p => p.priceJpy))),
            "highPrice": String(Math.max(...(allDbPlans as FsPlan[]).map(p => p.priceJpy))),
            "priceCurrency": "JPY",
            "offerCount": String((allDbPlans as FsPlan[]).length),
            "availability": "https://schema.org/InStock",
            "seller": { "@type": "Organization", "name": "yah.mobile", "url": "https://yah.mobi" },
            "offers": (allDbPlans as (FsPlan & { description?: string | null })[]).map((p) => ({
              "@type": "Offer",
              "name": p.name,
              "description": p.description ?? `${p.dataGb}GB / ${p.validityDays} days`,
              "price": String(p.priceJpy),
              "priceCurrency": "JPY",
              "url": `${pageUrl}?plan=${p.bappyPlanId}&open=true`,
              "availability": "https://schema.org/InStock",
              "seller": { "@type": "Organization", "name": "yah.mobile" },
            })),
          }
        : undefined,
    };
    const productScript = Object.assign(document.createElement("script"), {
      type: "application/ld+json",
      id: "schema-product",
      textContent: JSON.stringify(productSchema),
    });
    document.getElementById("schema-product")?.remove();
    document.head.appendChild(productScript);

    return () => {
      document.getElementById("schema-faq")?.remove();
      document.getElementById("schema-product")?.remove();
    };
  }, [allDbPlans, i18n.language, t]);

  const openDrawer = (planId?: string) => {
    setDrawerPlanId(planId);
    // プラン指定なし（HERO/CTAの汎用起動）は選択状態をクリアしてStep0から
    setDrawerInitialDays(undefined);
    setDrawerInitialGb(undefined);
    setDrawerOpen(true);
    if (planId) trackEvent("plan_select", { planId });
  };

  const faqItems = t("faq.items", { returnObjects: true }) as Array<{ q: string; a: string | React.ReactNode }>;

  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <Suspense fallback={null}>
        <PurchaseDrawer open={drawerOpen} onOpenChange={setDrawerOpen} initialPlanId={drawerPlanId} initialDays={drawerInitialDays} initialGb={drawerInitialGb} initialStep={drawerInitialStep} initialOrderId={drawerOrderId} />
      </Suspense>

      <main id="main-content">
      {/* ─── HERO ─── */}
      <section className="relative h-screen min-h-[600px] flex items-end overflow-hidden bg-black">
        {/* Mobile: static WebP image (LCP) — 常に即表示 */}
        <img
          src={HERO_MOBILE_IMG}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover md:hidden"
        />
        {/* Mobile: 縦動画を遅延ロードし、再生可能になったら画像の上にフェードイン */}
        {loadMobileVideo && (
          <video
            src={HERO_MOBILE_VIDEO}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            poster={HERO_MOBILE_IMG}
            aria-hidden="true"
            onCanPlay={() => setMobileVideoReady(true)}
            className={`absolute inset-0 w-full h-full object-cover md:hidden transition-opacity duration-700 ease-out ${mobileVideoReady ? "opacity-100" : "opacity-0"}`}
          />
        )}
        {/* Desktop: looping video */}
        <video
          src={HERO_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster={CITY_IMG}
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover hidden md:block"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="relative container pb-16 lg:pb-24">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="text-white/55 mb-4"
           
          >
            {t("hero.tagline")}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.85, delay: 0.38, ease: [0.23, 1, 0.32, 1] }}
            className="text-white max-w-2xl"
            style={serif("clamp(3rem, 7vw, 5.5rem)")}
          >
            {t("hero.title").split("\n").map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55, ease: [0.23, 1, 0.32, 1] }}
            className="text-white/65 mt-6 max-w-md"
           
          >
            {t("hero.subtitle")}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.72, ease: [0.23, 1, 0.32, 1] }}
            className="mt-8 flex flex-wrap gap-4"
          >
            <button
              onClick={() => { openDrawer(); trackEvent("hero_cta_click"); }}
              aria-label="Buy Japan eSIM — opens plan selection"
              className="inline-block bg-white text-black px-8 py-3.5 hover:bg-[#F7F7F7] transition-colors duration-200 active:scale-[0.97]"
              style={{ fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase" }}
            >
              {t("hero.cta")}
            </button>
          </motion.div>
        </div>
      </section>

      {/* ─── SOCIAL PROOF ─── */}
      <section className="py-14 bg-white border-b border-[#E8E8E8]">
        <div className="container">
          <FadeIn>
            <div className="flex flex-col sm:flex-row sm:items-start gap-8 sm:gap-12">
              <div className="flex-shrink-0">
                <div className="flex items-center gap-1 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} width="16" height="16" viewBox="0 0 24 24" fill="#000">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  ))}
                  <span className="ml-2 text-black" style={{ fontSize: "0.9375rem", fontWeight: 500 }}>5.0</span>
                </div>
                <p className="text-black/40" style={{ fontSize: "0.6875rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>{t("socialProof.rating")}</p>
              </div>
              <div className="hidden sm:block w-px h-16 bg-[#D7D7D7] self-center" />
              <div className="flex gap-8 overflow-x-auto pb-1 flex-1 snap-x snap-mandatory scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[
                  { text: t("socialProof.review1"), author: "Sarah M.", flag: "🇺🇸" },
                  { text: t("socialProof.review2"), author: "Lucas B.", flag: "🇫🇷" },
                  { text: t("socialProof.review3"), author: "Yuki T.", flag: "🇦🇺" },
                ].map((r, i) => (
                  <div key={i} className="flex-shrink-0 max-w-[220px] snap-start">
                    <div className="flex gap-0.5 mb-2">
                      {[...Array(5)].map((_, j) => (
                        <svg key={j} width="11" height="11" viewBox="0 0 24 24" fill="#000">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      ))}
                    </div>
                    <p className="text-black/65 mb-2" style={{ fontSize: "0.875rem", lineHeight: 1.65 }}>&#8220;{r.text}&#8221;</p>
                    <p className="text-black/35" style={{ fontSize: "0.75rem" }}>{r.flag} {r.author}</p>
                  </div>
                ))}
              </div>
              {/* モバイル用スクロールインジケーター */}
              <div className="flex justify-center gap-1.5 mt-4 sm:hidden">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-black/20" />
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── SUPPORT STRIP ─── */}
      <section className="py-7 bg-[#F7F7F7] border-b border-[#E8E8E8]">
        <div className="container">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-black" style={{ fontSize: "0.9375rem", fontWeight: 500 }}>{t("support.heading")}</p>
              <p className="text-black/45 mt-0.5" style={{ fontSize: "0.8125rem" }}>{t("support.subheading")}</p>
            </div>
            <button
              onClick={() => document.getElementById("chat")?.scrollIntoView({ behavior: "smooth" })}
              aria-label="Start a support chat — scroll to chat section"
              className="inline-flex items-center gap-2 bg-black text-white px-6 py-2.5 hover:bg-black/80 transition-colors duration-200 active:scale-[0.97] whitespace-nowrap self-start sm:self-auto"
              style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase" }}
            >
              <MessageCircle size={13} />
              {t("support.cta")}
            </button>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section className="py-24 lg:py-36 bg-white">
        <div className="container">
          <FadeIn>
            <p className="text-black/35 mb-3">{t("features.sectionLabel")}</p>
            <h2 className="text-black" style={serif("clamp(2.25rem, 4.5vw, 3.75rem)")}>{t("features.title")}</h2>
          </FadeIn>
          <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 border-t border-l border-[#D7D7D7]">
            {FEATURE_KEYS.map((f, i) => {
              const Icon = FEATURE_ICONS[f.icon];
              return (
                <FadeIn key={i} delay={i * 0.07} className="contents">
                  <div className="p-8 border-b border-r border-[#D7D7D7]">
                    <div className="mb-6">
                      {Icon && <Icon size={40} strokeWidth={1.25} className="text-black" />}
                    </div>
                    <h3 className="text-black mb-2" style={{ fontSize: "0.9375rem", fontWeight: 500 }}>
                      {t(`features.items.${f.key}.title`)}
                    </h3>
                    <p className="text-black/50" style={{ fontSize: "0.875rem", lineHeight: 1.75 }}>
                      {t(`features.items.${f.key}.desc`)}
                    </p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <Suspense fallback={<div className="py-24 bg-white" />}>
        <HowItWorksSection />
      </Suspense>

      {/* ─── FULL-BLEED IMAGE ─── */}
      <section className="relative h-[55vh] min-h-[320px] overflow-hidden">
        <img src={CITY_IMG} alt="Tokyo" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative container h-full flex items-center">
          <FadeIn>
            <p className="text-white max-w-lg" style={serif("clamp(1.75rem, 3.5vw, 2.75rem)")}>
              {t("midBanner1")}
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ─── COMPATIBILITY ─── */}
      <section id="compatibility" className="py-24 lg:py-36 bg-white">
        <div className="container">
          <FadeIn>
            <p className="text-black/35 mb-3">{t("compatibility.sectionLabel")}</p>
            <h2 className="text-black" style={serif("clamp(2rem, 4vw, 3.25rem)")}>{t("compatibility.title")}</h2>
            <p className="text-black/50 mt-4 max-w-md" style={{ fontSize: "0.9375rem", lineHeight: 1.7 }}>
              {t("compatibility.subtitle")}
            </p>
          </FadeIn>
          <Suspense fallback={<div className="h-64" />}>
            <FadeIn delay={0.1}><DeviceChecker /></FadeIn>
            <FadeIn delay={0.2}><ReferenceAccordion /></FadeIn>
          </Suspense>
        </div>
      </section>

      {/* ─── PLANS ─── */}
      <Suspense fallback={<div className="py-24 bg-white" />}>
        <PlansSection onSelectPlan={(days: number, gb: string, _priceJpy, bappyPlanId) => {
          if (bappyPlanId) setDrawerPlanId(bappyPlanId);
          // 選択済みの日数・GBを直接引き継ぐ（Firestore依存なしで即Step2表示）
          setDrawerInitialDays(days);
          setDrawerInitialGb(gb);
          setDrawerInitialStep(undefined);
          setDrawerOpen(true);
          trackEvent("plan_select", { planId: bappyPlanId, days, gb });
        }} />
      </Suspense>

      {/* ─── PRICE COMPARISON ─── */}
      <section id="price-comparison" className="py-24 lg:py-36 bg-[#F7F7F7]">
        <div className="container">
          <FadeIn>
            <p className="text-black/35 mb-3">{t("priceComparison.sectionLabel")}</p>
            <h2 className="text-black" style={serif("clamp(2rem, 4vw, 3.25rem)")}>{t("priceComparison.title")}</h2>
            <p className="text-black/50 mt-4 max-w-xl" style={{ fontSize: "0.9rem", lineHeight: 1.7 }}>
              {t("priceComparison.subtitle")}
            </p>
          </FadeIn>
          <Suspense fallback={<div className="h-96" />}>
            <ComparisonTable />
          </Suspense>
        </div>
      </section>

      {/* ─── NATURE FULL-BLEED ─── */}
      <section className="relative h-[55vh] min-h-[320px] overflow-hidden">
        <img src={NATURE_IMG} alt="Mount Fuji" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative container h-full flex items-center justify-end">
          <FadeIn>
            <div className="text-right">
              <p className="text-white/70 mb-3">{t("midBanner2.label")}</p>
              <p style={{ ...serif("clamp(1.75rem, 3.5vw, 3rem)"), color: "#fff" }}>
                {t("midBanner2.title").split("\n").map((line, i, arr) => (
                  <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                ))}
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="py-24 lg:py-36 bg-white">
        <div className="container max-w-3xl">
          <FadeIn>
            <p className="text-black/35 mb-3">{t("faq.sectionLabel")}</p>
            <h2 className="text-black" style={serif("clamp(2rem, 4vw, 3.25rem)")}>{t("faq.title")}</h2>
          </FadeIn>
          <div className="mt-12 border-t border-[#D7D7D7]">
            {faqItems.map((faq, i) => (
              <FadeIn key={i} delay={i * 0.04}>
                <div className="border-b border-[#D7D7D7]">
                  <button
                    className="w-full flex items-center justify-between py-6 text-left group"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    <span className="text-black group-hover:opacity-50 transition-opacity pr-8" style={{ fontSize: "0.9375rem" }}>
                      {faq.q}
                    </span>
                    <span
                      className="text-black/35 shrink-0 text-xl transition-transform duration-200"
                      style={{ transform: openFaq === i ? "rotate(45deg)" : "rotate(0deg)", display: "inline-block" }}
                    >
                      +
                    </span>
                  </button>
                  <motion.div
                    initial={false}
                    animate={{ height: openFaq === i ? "auto" : 0, opacity: openFaq === i ? 1 : 0 }}
                    transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="pb-6 text-black/55" style={{ fontSize: "0.9rem", lineHeight: 1.8 }}>
                      {faq.a}
                    </p>
                  </motion.div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CHAT SUPPORT ─── */}
      <section id="chat" className="py-24 lg:py-36 bg-[#F5F5F5] border-t border-[#D7D7D7]">
        <div className="container max-w-3xl">
          <FadeIn>
            <p className="text-black/35 mb-3">{t("chatSupport.sectionLabel")}</p>
            <h2 className="text-black mb-6" style={serif("clamp(2rem, 4vw, 3.25rem)", 300)}>
              {t("chatSupport.title").split("\n").map((line, i, arr) => (
                <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
              ))}
            </h2>
            <p className="text-black/50 mb-10 max-w-lg" style={{ fontSize: "0.9375rem", lineHeight: 1.75 }}>
              {t("chatSupport.subtitle")}
            </p>
            <button
              onClick={() => (document.getElementById("yah-chat-btn") as HTMLButtonElement | null)?.click()}
              aria-label="Open live chat support"
              className="inline-block bg-black text-white px-10 py-4 hover:bg-black/80 transition-colors duration-200 active:scale-[0.97]"
              style={{ fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase" }}
            >
              {t("chatSupport.cta")}
            </button>
          </FadeIn>
        </div>
      </section>

      {/* ─── CONTACT ─── */}
      <Suspense fallback={<div className="py-24 bg-white" />}>
        <ContactSection />
      </Suspense>

      {/* ─── CTA BANNER ─── */}
      <section className="relative bg-black py-20 lg:py-28 overflow-hidden">
        <video
          src={HERO_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          preload={isMobile ? "none" : "auto"}
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/60" />
        <div className="relative container text-center">
          <FadeIn>
            <h2 className="text-white mb-6" style={serif("clamp(2.25rem, 5vw, 4.5rem)")}>{t("ctaBanner.title")}</h2>
            <p className="text-white/45 mb-10 max-w-sm mx-auto" style={{ fontSize: "1rem", lineHeight: 1.7 }}>
              {t("ctaBanner.subtitle")}
            </p>
            <button
              onClick={() => { openDrawer(); trackEvent("cta_banner_click"); }}
              aria-label="Get your Japan eSIM — opens plan selection"
              className="inline-block bg-white text-black px-10 py-4 hover:bg-[#F7F7F7] transition-colors duration-200 active:scale-[0.97]"
              style={{ fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase" }}
            >
              {t("ctaBanner.cta")}
            </button>
          </FadeIn>
        </div>
      </section>

      {/* ─── LEGAL ACCORDION ─── */}
      <Suspense fallback={<div className="py-24 bg-white" />}>
        <LegalSection />
      </Suspense>
      </main>

      <Footer />
    </div>
  );
}
