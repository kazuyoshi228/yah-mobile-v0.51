// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Astro公開面（GEO/静的）。既存Viteの SPA(client/) とは衝突させない：
// - srcDir: 専用 src-astro/（client/src とは別）
// - outDir: dist/astro/（SPAの dist/public を壊さない・P1隔離。統合時に dist/public へ寄せる）
// Astro内部はVite 7（astro 6.4.8）＝リポと同一メジャー。
export default defineConfig({
  site: "https://yah.mobi",
  srcDir: "./src-astro",
  outDir: "./dist/astro",
  publicDir: "./src-astro/public",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@": path.resolve(import.meta.dirname, "client", "src"),
      },
    },
  },
});
