import { test, expect } from "@playwright/test";

/** ランディングの表示スモーク（非破壊・読み取りのみ） */
test.describe("landing", () => {
  test("/app が表示され、ヒーロー文言が出る", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveTitle(/yah\.mobile/i);
    await expect(page.getByText("Local Brand. Global Support.")).toBeVisible();
  });

  test("フッターが表示される", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("footer")).toBeVisible();
  });
});
