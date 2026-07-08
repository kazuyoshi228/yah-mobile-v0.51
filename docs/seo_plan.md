# SEO & GEO 計画書 — yah.mobile

作成: 2026-07-08 ／ 現状監査に基づく。実装は各ティア着手前に承認（CLAUDE.md）。
GEO = Generative Engine Optimization（ChatGPT / Perplexity / Google AI Overviews / Gemini / Claude 等の生成AIに**正しく引用される**ための最適化）。§7 参照。

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

---

# 7. GEO（生成AI最適化）

生成AI（ChatGPT/Perplexity/Google AI Overviews/Gemini/Claude）は「eSIM Japan おすすめ」「Japan eSIM 料金」等の質問に**要約＋引用**で答える。ここで**正確に・好意的に引用される**ための最適化がGEO。SEO（青リンク順位）とは別軸で、旅行系は生成AI経由の流入が急増中。

## 7.0 現状監査（GEO）

**✅ 既にある（強い）**
- **動的 `llms.txt`**（`functions/src/llmsTxt.ts` → `https://yah.mobi/llms.txt`）：ライブの12プラン・最低価格・返金ポリシー・FAQ・多言語・競合比較を**機械可読**で提供。GEOの理想形。鮮度は `Updated At` 付き。
- `robots.txt`：`User-agent: *` で全許可＋GPTBot/ClaudeBot/PerplexityBot を明示歓迎。
- 構造化データ：Product/FAQPage/AggregateRating/Review/Organization。AIが事実抽出しやすい。

**⚠️ 問題・改善余地**

| # | 検出 | 重大度 | 影響 |
|---|---|---|---|
| **G-1** | **事実不整合（網）**：サイト全体・`llms.txt`・meta・schema・比較表が **「KDDI (au)」** と記載。だが**現販売プランは6/6 NTT docomo（IIJ）**。`llmsTxt.ts` の "Airalo uses SoftBank / we use KDDI" 比較も誤り | 🔴**最優先** | AIが「KDDI」と誤引用＝信頼失墜／**景表法 優良誤認（→v0.8-2 法務と同一）**。※docomoは日本**最大**網なので訂正はむしろ訴求強化 |
| G-2 | AIクローラの明示許可が3種のみ | 中 | `*`で許可済だが、`OAI-SearchBot`/`ChatGPT-User`/`Google-Extended`/`Applebot-Extended`/`CCBot`(Common Crawl=多くのLLMの学習源) 等を明示すると取りこぼし減 |
| G-3 | HowTo構造化データ不在 | 中 | 「how to set up Japan eSIM」系でAIに手順を引用されやすくなる（サイトに"4ステップ"は既にある） |
| G-4 | `llms-full.txt` 不在 | 低 | llms.txt（索引）＋llms-full.txt（全文）の慣習。より多くを機械可読化 |
| G-5 | 回答志向コンテンツの厚み | 中 | 「日本 eSIM どれがいい」「対応端末」「エリア」等に**定義＋数値＋比較表**で直接答えるページ＝AI引用の主要素材（Tier3-2と重なる） |
| G-6 | エンティティ/権威シグナル | 中 | Organizationに`sameAs`(SNS)・外部被引用・レビュー増。AIの「信頼できるエンティティ」判定に効く |

## 7.1 GEO 実行プラン

| ティア | 項目 | 内容 |
|---|---|---|
| ~~即時🔴~~ ✅ | **G-1 事実整合（KDDI→NTT docomo）＝完了・本番反映(2026-07-08)** | サイトコピー(5言語)・`llmsTxt.ts`・`index.html` meta/schema・比較表(Firestore)・比較フォールバックの "KDDI/au" を **"NTT docomo"** に統一（日本最大網として訴求／'second-largest'→'largest'）。本番HTML+llms.txt の KDDI=0件を確認 |
| **Tier1** | G-2 AIクローラ明示許可 | `robots.txt` に OAI-SearchBot / ChatGPT-User / Google-Extended / Applebot-Extended / CCBot / PerplexityBot(既) を Allow で明示 |
| **Tier1** | G-4 llms-full.txt | 既存 `llmsTxt.ts` を拡張し全文版を配信（任意・低工数） |
| **Tier1** | G-3 HowTo schema | eSIM設定4ステップを HowTo 構造化データ化（AppPage/index.html） |
| **Tier3** | G-5 回答志向コンテンツ | SEO Tier3-2 と統合（ガイド/比較/国別ページ）。**AIが抜き出す"数値・表・定義"を正確に** |
| **Tier3** | G-6 権威 | `sameAs`(SNS)・レビュー・外部リスティングで被引用を増やす（オフページ） |

## 7.2 GEO 計測
- **実地確認**：ChatGPT/Perplexity/Google(AI Overviews) に「best eSIM for Japan」「Japan eSIM cheap」等を投げ、**yah.mobile が引用されるか・記載が正確か**を定期チェック（無料でできる最重要KPI）。
- Search Console の「AI Overviews」露出（提供範囲で）も監視。

> **最重要**：G-1（KDDI→docomo）は SEO/GEO/法務すべてに跨る**事実の誤り**。何より先に直すべき。訂正は訴求低下ではなく、**「日本最大のNTT docomo網」への格上げ**になる。
