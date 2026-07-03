import { motion } from "framer-motion";
import { Link } from "wouter";
import { safeUrl } from "@/lib/utils";
import type { EsimLink } from "./types";

function detectDevice(): "ios" | "android" | "other" {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}

export function ActiveEsimSummary({
  esimLink,
  planName,
  onViewDetail,
}: {
  esimLink: EsimLink;
  planName?: string | null;
  onViewDetail: () => void;
}) {
  const device = detectDevice();
  const expiryDisplay = esimLink.expiryDate
    ? new Date(esimLink.expiryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  const activationUrl = safeUrl(
    device === "ios" ? esimLink.appleActivationUrl :
    device === "android" ? esimLink.androidActivationUrl :
    esimLink.appleActivationUrl ?? esimLink.androidActivationUrl
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-10 border border-black bg-black text-white p-6 sm:p-8"
    >
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-label text-[0.6rem] text-white/40 mb-2">ACTIVE eSIM</p>
          <p className="font-sans font-medium text-white text-lg leading-tight">
            {planName ?? "eSIM Ready"}
          </p>
          {esimLink.iccid && (
            <p className="font-sans text-white/30 text-xs mt-0.5 font-mono">{esimLink.iccid}</p>
          )}
          {expiryDisplay && (
            <p className="font-sans text-white/40 text-xs mt-1">Expires {expiryDisplay}</p>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-white/10 text-white text-[0.6rem] font-sans font-medium tracking-[0.15em] uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Active
        </span>
      </div>

      {esimLink.dataRemainingMb != null && esimLink.dataTotalMb != null && (
        <div className="mb-6">
          <div className="flex justify-between items-center mb-1.5">
            <span className="font-sans text-white/40 text-xs">Data Remaining</span>
            <span className="font-sans text-white text-xs font-medium">
              {(esimLink.dataRemainingMb / 1024).toFixed(2)} GB / {(esimLink.dataTotalMb / 1024).toFixed(1)} GB
            </span>
          </div>
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-white"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, Math.round((esimLink.dataRemainingMb / esimLink.dataTotalMb) * 100))}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {activationUrl && (
          <a
            href={activationUrl}
            className="text-label text-[0.7rem] inline-flex items-center gap-2 bg-white text-black px-5 py-2.5 hover:bg-white/90 transition-colors duration-200 active:scale-[0.97]"
          >
            {device === "ios" ? (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                <path d="M17.523 15.341a.75.75 0 0 1-.75.75H7.227a.75.75 0 0 1-.75-.75V8.659a.75.75 0 0 1 .75-.75h9.546a.75.75 0 0 1 .75.75v6.682zM6 6.5l-1.5-2.6M18 6.5l1.5-2.6M8.5 3.9l.5.866M15.5 3.9l-.5.866"/>
              </svg>
            )}
            Activate eSIM
          </a>
        )}
        <button
          onClick={onViewDetail}
          className="text-label text-[0.7rem] inline-flex items-center gap-1.5 border border-white/30 text-white px-5 py-2.5 hover:border-white/60 transition-colors duration-200"
        >
          View details →
        </button>
        {esimLink.bappyLinkUuid && (
          <Link href={`/mypage/topup/${esimLink.id}`}>
            <span className="text-label text-[0.7rem] inline-flex items-center gap-1.5 border border-transparent bg-white text-black px-5 py-2.5 hover:bg-white/90 transition-colors duration-200 cursor-pointer">
              Top-up Data +
            </span>
          </Link>
        )}
      </div>
    </motion.div>
  );
}
