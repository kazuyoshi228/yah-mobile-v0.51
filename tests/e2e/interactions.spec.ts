import { test, expect } from "@playwright/test";

/** 操作系（非破壊・書き込みなし） */

test("言語スイッチャーで Korean に切り替えられる", async ({ page }) => {
  await page.goto("/app");
  await page.locator('button[aria-label="Change language"]:visible').first().click();
  await page.getByRole("button", { name: /한국어/ }).click();
  await expect(page).toHaveURL(/\/ko\/app/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

test("参照アコーディオンが開閉する（aria-expanded）", async ({ page }) => {
  await page.goto("/app");
  const acc = page.locator("button[aria-expanded]").first();
  await expect(acc).toHaveAttribute("aria-expanded", "false");
  await acc.click();
  await expect(acc).toHaveAttribute("aria-expanded", "true");
});

test("FAQ: 質問クリックで回答が開く（コンテナ高さで判定）", async ({ page }) => {
  await page.goto("/app");
  // 回答を包む overflow-hidden コンテナ（閉=height 0 / 開=auto）
  const container = page
    .getByText("You confirm this policy via a checkbox", { exact: false })
    .locator("xpath=ancestor::div[contains(@class,'overflow-hidden')][1]");
  // 初期は閉じている（高さ ~0）
  expect((await container.boundingBox())?.height ?? 999).toBeLessThan(5);
  // 質問をクリック → 開く
  await page.getByText("Can I get a refund?", { exact: true }).click();
  await expect
    .poll(async () => (await container.boundingBox())?.height ?? 0, { timeout: 5_000 })
    .toBeGreaterThan(20);
});
