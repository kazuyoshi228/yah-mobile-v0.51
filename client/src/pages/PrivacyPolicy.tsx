import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

function LegalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 py-5 border-b border-[#D7D7D7] last:border-0">
      <p className="font-sans font-medium text-black/40 text-[0.75rem] tracking-[0.04em] sm:w-52 shrink-0 uppercase">{label}</p>
      <p className="font-sans text-black/70 text-[0.875rem] leading-[1.75]">{value}</p>
    </div>
  );
}

export default function PrivacyPolicy() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Nav />
      <main className="flex-1 pt-24 pb-24">
        <div className="container max-w-3xl">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-10 text-[0.75rem] font-sans text-black/35 tracking-[0.04em] uppercase">
            <Link href="/app" className="hover:text-black transition-colors">{t("nav.home")}</Link>
            <span>/</span>
            <span className="text-black/60">{t("footer.privacy")}</span>
          </div>

          <p className="text-label text-black/35 mb-3 uppercase tracking-[0.08em]">Legal</p>
          <h1 className="font-sans font-light text-black mb-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            Privacy Policy
          </h1>
          <p className="font-sans text-black/40 text-[0.8125rem] mb-12">Last updated: June 27, 2026</p>

          {/* Overview */}
          <div className="mb-10">
            <p className="font-sans text-black/70 text-[0.9375rem] leading-[1.8]">
              yah.mobile ("we", "our", "us") is committed to protecting your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our eSIM service.
            </p>
          </div>

          {/* Data Table */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">Data We Collect &amp; How We Use It</h2>
            <div className="border border-[#D7D7D7]">
              <LegalRow label="Data Collected" value="Name, email address, payment information (managed by Stripe), device information, IP address, usage data" />
              <LegalRow label="Purpose of Use" value="eSIM delivery, customer support, service improvement, legal compliance, fraud prevention" />
              <LegalRow label="Third-Party Disclosure" value="Network carrier (eSIM issuance), Stripe (payment processing), as required by law. We do not sell your personal data." />
              <LegalRow label="Retention Period" value="Transaction records: 7 years (statutory requirement under Japanese Commercial Code). Consent records (purchase consent, terms acceptance): 7 years (GDPR Article 5(1)(e) / APPI compliance). Account data: deleted within 90 days of account closure upon request. Analytics data: 26 months. Marketing consent: retained until opt-out or account deletion.\n\n同意記録（購入同意・利用規約同意）は、日本の商法およびGDPR第5条第1項(e)に基づき、7年間保管します。" />
              <LegalRow label="Governing Law" value="Laws of Japan" />
              <LegalRow label="APPI" value="Compliant with Japan's Act on the Protection of Personal Information (APPI). You have the right to request disclosure, correction, or deletion of your personal data." />
              <LegalRow label="GDPR" value="GDPR-compliant for data processing of EU residents. Legal basis: contract performance and legitimate interests." />
              <LegalRow label="UK GDPR" value="UK GDPR-compliant for data processing of UK residents." />
            </div>
          </section>

          {/* Rights */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">Your Rights</h2>
            <div className="space-y-4">
              {[
                { title: "Access", body: "You may request a copy of the personal data we hold about you." },
                { title: "Correction", body: "You may request correction of inaccurate or incomplete personal data." },
                { title: "Deletion", body: "You may request deletion of your personal data, subject to legal retention requirements." },
                { title: "Opt-out", body: "You may opt out of marketing communications at any time by contacting us or using the unsubscribe link in emails." },
              ].map((item) => (
                <div key={item.title} className="flex flex-col sm:flex-row gap-4 py-5 border-b border-[#D7D7D7] last:border-0">
                  <p className="font-sans font-medium text-black/40 text-[0.75rem] tracking-[0.04em] sm:w-52 shrink-0 uppercase">{item.title}</p>
                  <p className="font-sans text-black/70 text-[0.875rem] leading-[1.75]">{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Cookies */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">Cookies</h2>
            <p className="font-sans text-black/70 text-[0.875rem] leading-[1.75]">
              Sign-in is handled by Google (Firebase Authentication) and does not rely on our own cookies. We use optional analytics cookies to understand how users interact with our service. You may manage your cookie preferences via the cookie banner displayed on your first visit, or at any time via our{" "}
              <a href="/cookie-policy" className="underline hover:text-black transition-colors">Cookie Policy</a>.
            </p>
          </section>

          {/* Contact */}
          <section className="mb-12">
            <h2 className="font-sans font-medium text-black text-[1rem] tracking-[0.04em] uppercase mb-6">Contact</h2>
            <p className="font-sans text-black/70 text-[0.875rem] leading-[1.75]">
              For privacy-related inquiries, please contact us via{" "}
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
