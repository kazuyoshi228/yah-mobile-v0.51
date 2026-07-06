import { defineConfig, devices } from "@playwright/test";

/**
 * E2E（非破壊・UI/リードのみ）。
 * バックエンドは本番共有のため、書き込み（購入・問い合わせ送信・ログイン）を伴うフローは対象外。
 * ここでは表示・ナビゲーション・i18n・法務ページなど「書き込みを起こさない」範囲を検証する。
 */
const PORT = 5178;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // 自動化ブラウザでも安定表示させるためのロケール固定
    locale: "en-US",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/app`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
