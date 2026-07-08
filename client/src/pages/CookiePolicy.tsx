import { Link } from "wouter";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 py-5 border-b border-[#D7D7D7] last:border-0">
      <p className="font-sans font-medium text-black/40 text-[0.75rem] tracking-[0.04em] sm:w-52 shrink-0 uppercase">{label}</p>
      <p className="font-sans text-black/70 text-[0.875rem] leading-[1.75]">{value}</p>
    </div>
  );
}

const cookies = [
  {
    category: "Essential",
    name: "Session / Auth Cookie",
    purpose: "Maintains your login session. Required for the service to function.",
    duration: "Session (cleared on browser close)",
    canOptOut: "No — required for service",
  },
  {
    category: "Essential",
    name: "Cookie Consent",
    purpose: "Stores your cookie preference (accepted / declined) so the banner is not shown on every visit.",
    duration: "1 year",
    canOptOut: "No — required to remember your choice",
  },
  {
    category: "Analytics",
    name: "Analytics",
    purpose: "Collects anonymised usage data (page views, session duration, referral source) to help us improve the service.",
    duration: "Up to 26 months",
    canOptOut: "Yes — decline via cookie banner or browser settings",
  },
];

export default function CookiePolicy() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Nav />
      <main className="flex-1 pt-24 pb-24">
        <div className="container max-w-3xl">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-10 text-[0.75rem] font-sans text-black/35 tracking-[0.04em] uppercase">
            <Link href="/app" className="hover:text-black transition-colors">Home</Link>
            <span>/</span>
            <span className="text-black/60">Cookie Policy</span>
          </div>

          <p className="text-label text-black/35 mb-3 uppercase tracking-[0.08em]">Legal</p>
          <h1 className="font-sans font-light text-black mb-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            Cookie Policy
          </h1>
          <p className="font-sans text-black/40 text-[0.8125rem] mb-12">Last updated: June 29, 2026</p>

          {/* Intro */}
          <div className="mb-10">
            <p className="font-sans text-black/70 text-[0.9375rem] leading-[1.8]">
              yah.mobile uses cookies and similar technologies to operate the service, remember your preferences, and understand how visitors use our site. This policy explains what cookies we use, why, and how you can control them.
            </p>
            <p className="font-sans text-black/70 text-[0.9375rem] leading-[1.8] mt-4">
              yah.mobileは、サービスの運営、お客様の設定の記憶、サイト利用状況の把握のためにCookieおよび類似技術を使用します。本ポリシーでは、使用するCookieの種類・目的・管理方法について説明します。
            </p>
          </div>

          {/* What are cookies */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">What Are Cookies?</h2>
            <p className="font-sans text-black/70 text-[0.875rem] leading-[1.75]">
              Cookies are small text files stored on your device when you visit a website. They allow the site to remember information about your visit, such as your login status and preferences. Cookies do not contain personally identifiable information on their own.
            </p>
          </section>

          {/* Cookie table */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">Cookies We Use</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[0.8125rem] font-sans border-collapse">
                <thead>
                  <tr className="border-b border-[#D7D7D7]">
                    <th className="text-left py-3 pr-4 font-medium text-black/40 tracking-[0.04em] uppercase w-24">Category</th>
                    <th className="text-left py-3 pr-4 font-medium text-black/40 tracking-[0.04em] uppercase w-40">Name</th>
                    <th className="text-left py-3 pr-4 font-medium text-black/40 tracking-[0.04em] uppercase">Purpose</th>
                    <th className="text-left py-3 pr-4 font-medium text-black/40 tracking-[0.04em] uppercase w-36">Duration</th>
                    <th className="text-left py-3 font-medium text-black/40 tracking-[0.04em] uppercase w-28">Opt-out</th>
                  </tr>
                </thead>
                <tbody>
                  {cookies.map((c) => (
                    <tr key={c.name} className="border-b border-[#D7D7D7] last:border-0">
                      <td className="py-4 pr-4 text-black/50 align-top">{c.category}</td>
                      <td className="py-4 pr-4 text-black/70 align-top font-medium">{c.name}</td>
                      <td className="py-4 pr-4 text-black/70 align-top leading-[1.6]">{c.purpose}</td>
                      <td className="py-4 pr-4 text-black/60 align-top leading-[1.6]">{c.duration}</td>
                      <td className="py-4 text-black/60 align-top leading-[1.6]">{c.canOptOut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* How to manage */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">How to Manage Cookies</h2>
            <div className="border border-[#D7D7D7]">
              <PolicyRow
                label="Cookie Banner"
                value="When you first visit yah.mobile, a cookie banner will appear. You can accept all cookies or decline non-essential cookies. You can change your preference at any time by clearing your browser's local storage."
              />
              <PolicyRow
                label="Browser Settings"
                value="Most browsers allow you to block or delete cookies via their settings. Sign-in is handled by Google (Firebase Authentication) and does not depend on our cookies, so blocking analytics cookies will not affect your ability to log in."
              />
              <PolicyRow
                label="Opt-out Links"
                value="To opt out of analytics tracking, you can use your browser's Do Not Track setting or install a browser extension such as uBlock Origin."
              />
            </div>
          </section>

          {/* Third parties */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">Third-Party Services</h2>
            <p className="font-sans text-black/70 text-[0.875rem] leading-[1.75]">
              We use the following third-party services that may set their own cookies: <strong>Stripe</strong> (payment processing — governed by{" "}
              <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-black transition-colors">Stripe's Privacy Policy</a>).
              We do not use advertising or tracking cookies from social media platforms.
            </p>
          </section>

          {/* Changes */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">Changes to This Policy</h2>
            <p className="font-sans text-black/70 text-[0.875rem] leading-[1.75]">
              We may update this Cookie Policy from time to time. Changes will be posted on this page with an updated date. Continued use of the service after changes constitutes acceptance.
            </p>
          </section>

          {/* Contact */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">Contact</h2>
            <p className="font-sans text-black/70 text-[0.875rem] leading-[1.75]">
              For questions about our use of cookies, please contact us via{" "}
              <a href="https://chat.yah.mobi" target="_blank" rel="noopener noreferrer" className="underline hover:text-black transition-colors">chat.yah.mobi</a>{" "}
              or by email at{" "}
              <a href="mailto:contact@mail.yah.mobi" className="underline hover:text-black transition-colors">contact@mail.yah.mobi</a>.
            </p>
          </section>

          {/* Back */}
          <Link href="/app" className="inline-flex items-center gap-2 font-sans text-black/40 text-[0.8125rem] hover:text-black transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
