import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { getActivePlans } from "./db";

// Airalo の競合価格（JPY）
const AIRALO_PRICES: Record<string, number> = {
  "3_1": 700,
  "3_3": 1250,
  "7_3": 1350,
  "7_5": 1700,
  "7_10": 2850,
  "15_5": 1750,
  "15_10": 2900,
  "30_5": 1850,
  "30_10": 3000,
  "30_20": 4150,
};

function getAiraloPrice(validityDays: number, dataGb: number | string): number | null {
  const gb = parseFloat(String(dataGb));
  const key = `${validityDays}_${gb}`;
  return AIRALO_PRICES[key] ?? null;
}

function formatPriceDiff(yahPrice: number, airaloPrice: number | null): string {
  if (airaloPrice === null) return "";
  const diff = airaloPrice - yahPrice;
  if (diff > 0) return ` (**¥${diff} cheaper than Airalo**)`;
  if (diff < 0) return ` (¥${Math.abs(diff)} more than Airalo)`;
  return " (same as Airalo)";
}

export async function generateLlmsTxt(): Promise<string> {
  const activePlans = await getActivePlans();

  const cheapestPlan = activePlans.length > 0
    ? activePlans.reduce((a, b) => a.priceJpy < b.priceJpy ? a : b)
    : null;

  const byDays: Record<number, typeof activePlans> = {};
  for (const p of activePlans) {
    if (!byDays[p.validityDays]) byDays[p.validityDays] = [];
    byDays[p.validityDays].push(p);
  }

  const planSections = Object.entries(byDays)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([days, plans]) => {
      const rows = plans.map(p => {
        const airaloPrice = getAiraloPrice(p.validityDays, p.dataGb);
        const priceDiff = formatPriceDiff(p.priceJpy, airaloPrice);
        const popular = p.isPopular === true ? " ⭐" : "";
        return `| ${p.dataGb}GB${popular} | ¥${p.priceJpy}${priceDiff} | ${p.bappyPlanId} | ${p.description ?? `${p.dataGb}GB data for ${days} days in Japan`} |`;
      });
      return `### ${days}-Day Plans\n\n| Data | Price (JPY) | Plan ID | Description |\n|------|-------------|---------|-------------|\n${rows.join("\n")}`;
    })
    .join("\n\n");

  const samplePlanId = cheapestPlan?.bappyPlanId ?? "JP_3D_1GB";
  const sampleDays = cheapestPlan?.validityDays ?? 3;
  const totalPlans = activePlans.length;
  const minPrice = cheapestPlan?.priceJpy ?? 990;
  const updatedAt = new Date().toISOString();

  return `# yah.mobile

> yah.mobile is a Japan eSIM provider offering instant digital SIM cards for travelers visiting Japan.
> Plans start from ¥${minPrice}, running on NTT docomo — Japan's largest carrier network (4G/LTE nationwide).
> No physical SIM card required. Scan a QR code and get connected immediately upon arrival in Japan.
> Fully compatible with unlocked eSIM-capable smartphones (iPhone XS and later, most Android flagships).

- Updated At: ${updatedAt}
- Active Plans: ${totalPlans}
- Minimum Price: ¥${minPrice}

## Service Summary

- **Service type**: Japan eSIM (embedded SIM) for international travelers
- **Coverage**: All of Japan (NTT docomo network — 4G/LTE)
- **Delivery**: Instant QR code via email after purchase
- **Activation**: Scan QR code before or after arriving in Japan
- **Refund policy**: eSIM is a digital product. Once payment is completed, cancellations and refunds are not available, except where we are unable to deliver the eSIM or top-up due to a technical problem on our side (a system error or an upstream provider failure) — in that case the payment is refunded in full, automatically, to the original payment method. Customers confirm this policy via a checkbox before completing purchase.
- **Support**: Live chat available on the website
- **Network**: NTT docomo — Japan's largest carrier, excellent nationwide coverage

## Plans (Live from Database)

All plans are data-only (no voice calls). Prices in Japanese Yen (JPY). ⭐ = Popular pick.

${planSections}

## Key Pages

- [Purchase eSIM (English)](https://yah.mobi/app): Main purchase page with plan selector
- [Purchase eSIM (Korean / 한국어)](https://yah.mobi/app/ko): Korean-language purchase page — 일본 eSIM 구매 페이지
- [Purchase eSIM (Simplified Chinese / 简体中文)](https://yah.mobi/app/zh): Simplified Chinese purchase page — 日本eSIM购买页面
- [Plans Section](https://yah.mobi/app#plans): Direct link to plan comparison
- [FAQ](https://yah.mobi/app#faq): Frequently asked questions about eSIM setup and compatibility
- [Device Compatibility](https://yah.mobi/app#compatibility): Check if your device supports eSIM
- [Contact / Support](https://yah.mobi/app#contact): Live chat and contact form

## Multilingual Support

- English: https://yah.mobi/app
- Korean (한국어): https://yah.mobi/app/ko — Full Korean-language page including FAQ, plans, and contact form
- Simplified Chinese (简体中文): https://yah.mobi/app/zh — Full Simplified Chinese page including FAQ, plans, and contact form
- hreflang annotations: hreflang="ko", hreflang="zh-CN", hreflang="zh-Hans" are present on all pages

## Frequently Asked Questions

**What is an eSIM?**
An eSIM (embedded SIM) is a digital SIM card built into your smartphone. Instead of inserting a physical SIM, you scan a QR code to activate a mobile data plan. No SIM tray, no waiting for delivery.

**Which devices are compatible?**
iPhone XS (2018) and later models. Most Android flagships from 2019 onward (Samsung Galaxy S20+, Google Pixel 3a+, etc.). The device must be unlocked (not carrier-locked).

**How do I activate the eSIM?**
After purchase, you receive a QR code by email. Go to your phone's Settings → Cellular/Mobile → Add eSIM → Scan QR Code. You can do this before or after arriving in Japan.

**Can I keep my existing SIM?**
Yes. The eSIM works alongside your existing physical SIM. You can switch between them in your phone settings.

**What if I need more data?**
Top-up plans are available. Contact support via live chat on the website.

**Is there a refund policy?**
eSIM is a digital product. Once payment is completed, cancellations and refunds are not available. Customers confirm this no-refund policy via a checkbox before completing their purchase, as required under Japan's Act on Specified Commercial Transactions (Article 15-3). The only exception is when we are unable to deliver your eSIM or top-up due to a technical problem on our side — in that case we refund your payment in full, automatically, to your original payment method. If you have questions, please contact support via live chat before purchasing.

**Can I use tethering (hotspot)?**
Yes. Tethering and mobile hotspot are fully supported. You can share your Japan data connection with laptops, tablets, or other devices.

**Which network does yah.mobile use?**
NTT docomo (via IIJ) — Japan's largest mobile carrier with excellent 4G/LTE coverage across all major cities and rural areas.

## Pricing Context

yah.mobile runs on NTT docomo network and offers competitive pricing with Japanese-language support and live chat.

| Plan | yah.mobile | Airalo | Difference |
|------|-----------|--------|------------|
| 3 days 1GB | ¥990 | ¥700 | Airalo cheaper |
| 7 days 5GB | ¥1,790 | ¥1,700 | Airalo cheaper |
| 30 days 10GB | ¥3,490 | ¥3,000 | Airalo cheaper |

**Why choose yah.mobile over Airalo?**
- NTT docomo network — Japan's largest carrier, reliable nationwide coverage
- Japanese-language customer support
- Live chat available 24/7
- Local Japan brand with deep local knowledge

## Contact

- Website: https://yah.mobi
- Operator: ボンファイア株式会社 (Bonfire Inc.)
- Support: Live chat at https://yah.mobi/app#chat
- Email: contact@mail.yah.mobi
- Contact form: https://yah.mobi/app#contact
`;
}

export const llmsTxt = onRequest(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    cors: true,
  },
  async (req, res) => {
    try {
      const content = await generateLlmsTxt();
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      // Cache for 10 minutes (Firebase Edge caching)
      res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600, stale-while-revalidate=3600");
      res.send(content);
    } catch (err) {
      logger.error("[llmsTxt] Failed to generate:", err);
      res.status(500).send("# yah.mobile\n\n> Service temporarily unavailable. Please try again later.\n");
    }
  }
);
