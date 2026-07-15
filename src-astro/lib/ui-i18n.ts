/**
 * ui-i18n.ts — 公開面(/esim)の「ページchrome」文字列を lang で引く（ビルド時i18n）
 *
 * guide本文は feed.translations[lang] がSSOT。ここはヘッダー/表見出し等の
 * UI文字列のみを言語別に持つ。react-i18next はロードしない（静的・軽量維持）。
 * feedが言語を増やしたら UI に該当langを追加する（未定義langは en にフォールバック）。
 */
export interface UiStrings {
  navHome: string;
  navBuy: string;
  navPlans: string;
  navFaq: string;
  navChat: string;
  navContact: string;
  signIn: string;
  menu: string;
  plansTitle: string;
  colPlan: string;
  colData: string;
  colValidity: string;
  colPrice: string;
  buy: string;
  buyCta: string;
  faqTitle: string;
  /** langロケールでの表示名（言語切替リンクのラベル用） */
  nativeName: string;
}

export const UI: Record<string, UiStrings> = {
  ja: {
    navHome: "ホーム",
    navBuy: "購入",
    navPlans: "プラン",
    navFaq: "よくある質問",
    navChat: "チャット",
    navContact: "お問い合わせ",
    signIn: "ログイン",
    menu: "メニュー",
    plansTitle: "プランと料金",
    colPlan: "プラン",
    colData: "データ",
    colValidity: "有効期間",
    colPrice: "料金",
    buy: "購入",
    buyCta: "eSIMを購入する",
    faqTitle: "よくある質問",
    nativeName: "日本語",
  },
  // en は未localized言語のフォールバック（SPA nav の英語ラベルに準拠）
  en: {
    navHome: "HOME",
    navBuy: "BUY",
    navPlans: "PLANS",
    navFaq: "FAQ",
    navChat: "CHAT",
    navContact: "CONTACT",
    signIn: "Sign in",
    menu: "Menu",
    plansTitle: "Plans & Pricing",
    colPlan: "Plan",
    colData: "Data",
    colValidity: "Validity",
    colPrice: "Price",
    buy: "Buy",
    buyCta: "Get your eSIM",
    faqTitle: "FAQ",
    nativeName: "English",
  },
};

export function getUi(lang: string): UiStrings {
  return UI[lang] ?? UI.en;
}

/** 「◯年◯月◯日時点」等、料金基準日の言語別表記。confirmedDate="YYYY-MM-DD"。 */
export function formatAsOf(lang: string, confirmedDate?: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(confirmedDate || "");
  if (!m) return null;
  const [, y, mo, d] = m;
  if (lang === "ja") {
    return `料金は${y}年${Number(mo)}月${Number(d)}日時点のものです。`;
  }
  // en 系フォールバック（月名短縮）
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Prices as of ${months[Number(mo) - 1]} ${Number(d)}, ${y}.`;
}
