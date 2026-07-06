import { test, expect } from "@playwright/test";

/**
 * プラン選択UI（Firestore の plans を読み取り→日数タブ描画）。
 * 読み取りのみ（購入は行わない）。App Check 等で plans が読めない環境ではスキップされうる。
 */
test("プラン日数タブが表示され、切替できる（読み取りのみ）", async ({ page }) => {
  await page.goto("/app");
  const day7 = page.getByRole("button", { name: /^7\s*days$/i });
  await expect(day7).toBeVisible({ timeout: 15_000 });

  const day15 = page.getByRole("button", { name: /^15\s*days$/i });
  await day15.click();
  await expect(day15).toBeVisible();
});
