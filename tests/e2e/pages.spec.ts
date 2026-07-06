import { test, expect } from "@playwright/test";

/** 法務ページ・404 の表示（非破壊） */
test("利用規約ページが表示される", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.locator("body")).toContainText(/terms/i);
});

test("プライバシーポリシーが表示される", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.locator("body")).toContainText(/privacy/i);
});

test("クッキーポリシーが表示される", async ({ page }) => {
  await page.goto("/cookie-policy");
  await expect(page.locator("body")).toContainText(/cookie/i);
});

test("未定義ルートは NotFound を表示する", async ({ page }) => {
  await page.goto("/this-route-does-not-exist-xyz");
  await expect(page.locator("body")).toContainText(/404|not found/i);
});
