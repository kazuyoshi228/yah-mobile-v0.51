# SEO 計画書 — yah.mobile

作成: 2026-07-08 ／ 現状監査に基づく。実装は各ティア着手前に承認（CLAUDE.md）。

## 0. 現状監査（実コード）

**✅ 既にある（良好）**
- `robots.txt`：クロール許可・AIボット歓迎（GPTBot/ClaudeBot/PerplexityBot）・admin/mypage/api を Disallow・sitemap参照
- `sitemap.xml`：**5言語**（en/ko/zh-CN/zh-TW/th）を hreflang alternate 付きで網羅
- 構造化データ：`index.html` に **Organization + WebSite**（静的）、`AppPage` に **FAQPage + Product + AggregateRating + Review + AggregateOffer**（JSで注入）
- OG/Twitter カード・canonical・`llms.txt`（AIエージェント向け）・PWA

**⚠️ 問題・改善余地（監査で検出）**
| # | 検出 | 影響 |
|---|---|---|
| A | **hreflang不整合**：`index.html` 静的headは `en/ja` のみ。sitemapは `en/ko/zh-CN/zh-TW/th`。**"ja" はUI非対応言語**で、ko/zh/thが抜けている。JSON-LDの `availableLanguage:["English","Japanese"]`・`inLanguage:["en","ja"]` も同様に誤り | 多言語SEOの取りこぼし・クローラ混乱 |
| B | **canonical が全ページ `/app` 固定**：SPAは全ルートで同一 `index.html` を配信するため、`/ko/app` 等でも canonical=`/app` になる | 言語別ページが正規化で消える恐れ |
| C | **CSRのみ（SSR/prerenderなし）**：title/description/Product JSON-LD を**JS実行後に注入**。Googlebotはレンダリングするが、SNSスクレイパや一部AIクローラは初期HTMLしか見ない。言語別metaも初期HTMLに出ない | 非Google流入・SNSプレビュー・多言語の弱さ |
| D | **言語別 `<head>` 不在**：全言語が同一の英語静的head（title/description/OG）を配信 | 非英語圏の検索最適化不足 |
| E | **薄いコンテンツ**：単一LP。ロングテール記事/ガイドなし | オーガニック上限が低い |
| F | **CSPに旧Manusドメイン残存**（`manus-analytics.com`/`yah-esim-*.manus.space`） | 直接SEO無関係だが衛生 |
| G | OG画像 `og-image.png` の存在/寸法(1200x630) 未確認／sitemapに法務ページ未収録 | 軽微 |

---

## 1. Tier 1 — 技術クイックウィン（低工数・すぐ着手可・私が実装可）

| 項目 | 内容 | 対象 |
|---|---|---|
| **T1-1 hreflang整合** | `index.html` の hreflang を **en/ko/zh-CN/zh-TW/th + x-default** に修正。JSON-LDの `inLanguage`/`availableLanguage` も5言語へ | client/index.html |
| **T1-2 OG画像 確認/整備** | `og-image.png` の実在・1200x630・公開ACL を確認。無ければ差し替え | Storage/index.html |
| **T1-3 sitemap微修正** | `lastmod` 付与・必要なら法務ページ(/terms等)を low priority で追加 | client/public/sitemap.xml |
| **T1-4 CSP衛生** | 旧Manusドメインを CSP から除去（S4の残骸）。SEO直接効果はないがセキュリティ/整合 | firebase.json |
| **T1-5 構造化データ強化** | Organization に `sameAs`(SNS)・`BreadcrumbList` 追加余地。既存Product/FAQは維持 | index.html/AppPage |

→ **いずれもデプロイ（hosting）で反映**。挙動不変・低リスク。**まずここから**。

---

## 2. Tier 2 — 言語別・動的 `<head>`（中工数）

| 項目 | 内容 |
|---|---|
| **T2-1 動的head** | `react-helmet-async` 等でルート/言語ごとに **title・description・canonical(self)・OG locale** を出し分け。`/ko/app` は canonical=`/ko/app`、OG locale=ko 等 |
| **T2-2 canonical自己参照** | Bの解消。言語別URLを正規URLに |

→ CSRのままでも「JS実行後の」metaは改善。ただし初期HTMLには出ないためTier3と併用が理想。

---

## 3. Tier 3 — レンダリング & コンテンツ（大工数・SEO最大レバー）

| 項目 | 内容 | 効果/コスト |
|---|---|---|
| **T3-1 プリレンダリング/SSG** | 主要ページ（`/`,`/app`,`/{lang}/app`,法務）をビルド時に**静的HTML化**し、言語別 meta＋JSON-LD を初期HTMLに埋める。候補: `vite-plugin-ssr(vike)` / `react-snap` / prerenderサービス / Cloud Functions SSR | **効果大/コスト大**。C・Dを根治 |
| **T3-2 コンテンツ拡充** | ガイド/ブログでロングテール獲得（"Japan eSIM 完全ガイド"・対応端末・エリア/カバレッジ・国別（韓国/台湾/タイからの旅行者向け）・比較記事）。FAQ拡張 | 効果大/継続運用 |
| **T3-3 Core Web Vitals** | Lighthouse/PageSpeed で LCP(hero)・CLS・INP を計測→改善（画像フォーマット・JS分割・遅延ロード）。フォントCORSは対応済み | 中/中 |

---

## 4. Tier 4 — オフページ（コード外・運用）

- **Google Search Console / Bing Webmaster Tools 登録**＋ sitemap 送信＋カバレッジ監視（最優先の"計測"）
- 被リンク・各種リスティング（旅行系）・レビュー獲得
- Analytics（既存 umami）と Search Console で検索流入をファネル可視化

---

## 5. 推奨順序

```
今すぐ  Tier1（技術クイックウィン・私が実装→デプロイ）
  │      ＋ Tier4の「Search Console登録」（あなた・計測の土台）
中期    Tier2（動的head）
  │
本命    Tier3-1（プリレンダリング）＝非Google/SNS/多言語を根治
継続    Tier3-2 コンテンツ ／ Tier3-3 CWV
```

## 6. 「今すぐ進めれる箇所」＝ Tier 1（承認あれば即実装）
A(hreflang)・F(CSP衛生)・G(OG/sitemap) は**低リスク・高整合**。次回 hosting デプロイに相乗り可能。
Tier2以降（動的head/プリレンダリング/コンテンツ）は工数が段違いなので、**Tier1実装後に費用対効果を見て個別承認**。
