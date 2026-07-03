import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseDb, getFirebaseApp } from "@/lib/firebase";
import { useAuth } from "@/_core/hooks/useAuth";
import FadeIn from "./FadeIn";
import { serif } from "./types";

interface FormData {
  name: string;
  email: string;
  location: string;
  category: string;
  detail: string;
  message: string;
}

export default function ContactSection() {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<FormData>({ name: "", email: "", location: "", category: "", detail: "", message: "" });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [locationDetected, setLocationDetected] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [formStartTime, setFormStartTime] = useState<number>(0);
  const { user } = useAuth();
  const sectionRef = useRef<HTMLElement>(null);

  // Category key → detail keys mapping
  const CATEGORY_DETAIL_KEYS: Record<string, string[]> = {
    purchasePayment: ["dontKnowHowToBuy", "paymentNotCompleting", "chargedTwice", "needReceiptInvoice"],
    esimSetup: ["qrCodeNotReceived", "cantScanQrCode", "installationFailed", "checkDeviceCompatibility"],
    connectionIssue: ["noConnectionAfterArrival", "slowSpeed", "dataStoppedWorking", "apnSettings"],
    accountOrders: ["orderNotShowing", "changeEmailAddress", "cantLogIn"],
    dataPrivacy: ["deleteMyAccount", "exportMyData", "correctMyData", "optOutMarketing"],
    other: ["notListedAbove"],
  };

  const CATEGORY_KEYS = Object.keys(CATEGORY_DETAIL_KEYS);

  // Location values (internal)
  const LOCATION_KEYS = ["homeCountry", "japan", "other"] as const;

  useEffect(() => {
    setFormStartTime(Date.now());
  }, []);

  useEffect(() => {
    if (locationDetected) return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const lang = navigator.language ?? "";
      let loc = "other";
      if (tz.startsWith("Asia/Tokyo") || tz === "Japan" || lang.startsWith("ja")) loc = "japan";
      else loc = "homeCountry";
      setFormData((prev) => ({ ...prev, location: loc }));
      setLocationDetected(true);
    } catch {
      // 検出失敗時はそのまま
    }
  }, [locationDetected]);

  useEffect(() => {
    if (user) {
      setFormData((prev) => ({
        ...prev,
        name: prev.name || user.name || "",
        email: prev.email || user.email || "",
      }));
    }
  }, [user]);

  const update = (key: keyof FormData, value: string) => setFormData((prev) => ({ ...prev, [key]: value }));

  const detailKeys = formData.category ? (CATEGORY_DETAIL_KEYS[formData.category] ?? []) : [];
  const hintText = formData.detail ? t(`contact.hints.${formData.detail}`) : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsPending(true);
    try {
      let orderId: string | null = null;
      if (user?.uid) {
        try {
          const ordersRef = collection(getFirebaseDb(), "orders");
          const q = query(ordersRef, where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(1));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            orderId = snapshot.docs[0].id;
          }
        } catch (err) {
          console.error("Failed to fetch latest order for contact", err);
        }
      }

      const submitInquiry = httpsCallable(getFunctions(getFirebaseApp(), "asia-northeast1"), "submitContactInquiry");
      await submitInquiry({
        name: formData.name || undefined,
        email: formData.email,
        location: formData.location || undefined,
        category: formData.category || undefined,
        detail: formData.detail || undefined,
        message: formData.message,
        orderId: orderId || undefined,
        formStartTime,
        _hp: honeypot || undefined,
      });
      setFormSent(true);
      // 送信完了後、Contact セクションのトップ（「Get in Touch」見出し）を表示する
      requestAnimationFrame(() => {
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err: any) {
      setFormError(err.message || "Failed to send. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <section ref={sectionRef} id="contact" className="scroll-mt-24 py-24 lg:py-32 bg-white border-t border-[#D7D7D7]">
      <div className="container max-w-2xl">
        <FadeIn>
          <p className="text-label text-black/35 mb-3">{t("contact.sectionLabel")}</p>
          <h2 className="text-black" style={serif("clamp(2rem, 4vw, 3.25rem)")}>{t("contact.title")}</h2>
          <p className="font-sans text-black/50 mt-4 mb-10 text-[0.9375rem] leading-[1.7]">
            {t("contact.subtitle")}
          </p>
        </FadeIn>

        {formSent ? (
          <FadeIn>
            <div className="bg-white p-10 text-center border border-[#D7D7D7]">
              <p className="font-sans font-light text-black mb-2 text-[1.25rem]">{t("contact.messageSent")}</p>
              <p className="font-sans text-black/50 text-[0.875rem]">{t("contact.messageSentDesc")}</p>
            </div>
          </FadeIn>
        ) : (
          <FadeIn delay={0.1}>
            <form
              className="space-y-0 border-t border-[#D7D7D7]"
              onSubmit={handleSubmit}
            >
              {/* Honeypot field - Hidden from real users */}
              <input
                type="text"
                name="_hp"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                style={{ display: "none" }}
                tabIndex={-1}
                autoComplete="off"
              />
              {/* Name + Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2">
                {(["name", "email"] as const).map((field, i) => (
                  <div key={field} className={`border-b border-[#D7D7D7] py-5 ${i === 1 ? "sm:pl-6 sm:border-l sm:border-l-[#D7D7D7]" : "sm:pr-6"}`}>
                    <label htmlFor={`contact-${field}`} className="text-label block mb-2 text-black/40">
                      {t(`contact.labels.${field}`)}
                      {field === "name" && (
                        <span className="ml-2 font-sans normal-case text-black/25 text-[0.65rem] tracking-normal">
                          (Optional)
                        </span>
                      )}
                    </label>
                    <input
                      id={`contact-${field}`}
                      type={field === "email" ? "email" : "text"}
                      value={formData[field]}
                      onChange={(e) => update(field, e.target.value)}
                      className="font-sans w-full bg-transparent text-black text-[1rem] focus:outline-none placeholder:text-black/20"
                      placeholder={field === "name" ? t("contact.namePlaceholder") : t("contact.emailPlaceholder")}
                      required={field === "email"}
                    />
                  </div>
                ))}
              </div>

              {/* Location */}
              <div className="border-b border-[#D7D7D7] py-5">
                <label className="text-label block mb-2 text-black/40">
                  {t("contact.labels.location")}
                  {locationDetected && (
                    <span className="ml-2 font-sans text-black/25 text-[0.65rem] tracking-[0.1em]">
                      {t("contact.autoDetected")}
                    </span>
                  )}
                </label>
                <div className="flex flex-wrap gap-2">
                  {LOCATION_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => update("location", key)}
                      className={`font-sans text-[0.75rem] tracking-[0.08em] px-4 py-2 border transition-colors duration-150 ${formData.location === key ? "border-black bg-black text-white" : "border-[#D7D7D7] text-black/50 hover:border-black/40"}`}
                    >
                      {t(`contact.locations.${key}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category */}
              <div className="border-b border-[#D7D7D7] py-5">
                <label className="text-label block mb-2 text-black/40">{t("contact.labels.category")}</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_KEYS.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => { update("category", cat); update("detail", ""); }}
                      className={`font-sans text-[0.75rem] tracking-[0.08em] px-4 py-2 border transition-colors duration-150 ${formData.category === cat ? "border-black bg-black text-white" : "border-[#D7D7D7] text-black/50 hover:border-black/40"}`}
                    >
                      {t(`contact.categories.${cat}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Detail */}
              <AnimatePresence>
                {formData.category && (
                  <motion.div
                    key="detail-section"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="border-b border-[#D7D7D7] py-5">
                      <label className="text-label block mb-2 text-black/40">{t("contact.labels.detail")}</label>
                      <div className="flex flex-wrap gap-2">
                        {detailKeys.map((key) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => update("detail", key)}
                            className={`font-sans text-[0.75rem] tracking-[0.08em] px-4 py-2 border transition-colors duration-150 ${formData.detail === key ? "border-black bg-black text-white" : "border-[#D7D7D7] text-black/50 hover:border-black/40"}`}
                          >
                            {t(`contact.details.${key}`)}
                          </button>
                        ))}
                      </div>
                      <AnimatePresence>
                        {formData.detail && hintText && (
                          <motion.div
                            key="hint-box"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.2 }}
                            className="mt-4 px-4 py-3 bg-black/[0.03] border border-[#D7D7D7]"
                          >
                            <p className="font-sans text-black/55 text-[0.8125rem] leading-[1.6]">
                              {hintText}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Note */}
              <div className="border-b border-[#D7D7D7] py-5">
                <label htmlFor="contact-note" className="text-label block mb-2 text-black/40">{t("contact.labels.note")}</label>
                <textarea
                  id="contact-note"
                  rows={4}
                  value={formData.message}
                  onChange={(e) => update("message", e.target.value)}
                  className="font-sans w-full bg-transparent text-black text-[1rem] focus:outline-none resize-none placeholder:text-black/20"
                  placeholder={t("contact.notePlaceholder")}
                  required
                />
              </div>

              {formError && (
                <p className="font-sans text-black/50 mt-4 text-[0.875rem]">{formError}</p>
              )}
              <div className="pt-8">
                <button
                  type="submit"
                  disabled={isPending}
                  className="text-label text-[0.75rem] bg-black text-white px-8 py-3.5 hover:bg-black/80 transition-colors duration-200 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPending ? t("contact.sending") : t("contact.sendMessage")}
                </button>
              </div>
            </form>
          </FadeIn>
        )}
      </div>
    </section>
  );
}
