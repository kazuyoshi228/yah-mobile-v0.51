import { test, expect } from "@playwright/test";

/** i18n ルーティング＋翻訳表示（5言語・非破壊） */
const LANGS = [
  { path: "/app", lang: "en", text: "Local Brand. Global Support." },
  { path: "/ko/app", lang: "ko" },
  { path: "/zh-CN/app", lang: "zh-CN" },
  { path: "/zh-TW/app", lang: "zh-TW", text: "本地品牌，全球支援。" },
  { path: "/th/app", lang: "th" },
];

for (const l of LANGS) {
  test(`${l.lang}: html lang が設定され、翻訳が表示される`, async ({ page }) => {
    await page.goto(l.path);
    await expect(page.locator("html")).toHaveAttribute("lang", l.lang);
    if (l.text) {
      await expect(page.getByText(l.text)).toBeVisible();
    }
  });
}
