import { test, expect } from "@playwright/test";

/** ランディングの主要セクションが揃って描画される（i18nベース・非破壊） */
const SECTION_TEXTS = [
  "Why yah.mobile",              // features
  "Price Comparison",            // priceComparison
  "Is your device compatible?",  // compatibility
  "Can I get a refund?",         // faq（一問）
  "Get in touch.",               // contact
];

test("主要セクションが表示される", async ({ page }) => {
  await page.goto("/app");
  for (const s of SECTION_TEXTS) {
    await expect(page.getByText(s, { exact: false }).first()).toBeVisible();
  }
});

test("問い合わせフォームの入力欄が表示される（送信はしない）", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByPlaceholder("Your name")).toBeVisible();
  await expect(page.getByPlaceholder("your@email.com")).toBeVisible();
});
