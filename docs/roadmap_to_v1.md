# ロードマップ v0.6 → v1.0（一般公開）— 残タスク台帳

更新: 2026-07-08 ／ **本書は「これからやること」だけ**。完了項目は削除し、要点のみ現在地に集約（履歴は git / seo_plan.md 参照）。

## 現在地（v0.6・稼働中）
- ✅ **eSIMAccess 単一プロバイダで本番稼働**（発行/同期/topup/cancel・販売停止ガード・死活監視・多層防御Webhook・自動返金・§8 cancel連携）
- ✅ **大規模リファクタ P0–P5 本番反映済み**（db/callables分割・secrets一元化・admin 2タブ削除・PurchaseDrawer Context分割 等）
- ✅ **topupリトライ不具合 修正済み**（本番反映）
- ✅ **v0.8 完了**：チャット設置（chat.yah.mobi）／特商法整備（ボンファイア株式会社・運営統括責任者=山田一慶・連絡先 chat＋contact@mail.yah.mobi）／返金ポリシー一貫性／**網の事実訂正（KDDI→NTT docomo）**
- ✅ 返金（Lane A/B・5言語メール）／可観測性（Error Reporting＋S9到達＋S10死活）／運用ランブック
- ⚠️ **未検証**：実発注の通し（実購入→発行→QR→返金）は**まだ一度も実施していない**
- ⚠️ **招待制ゲートON**：`allowed_emails` に無いユーザーは購入不可（＝一般公開前）

---

## v0.7 残り — 「動くことを証明する」
| # | 項目 | 内容・指示 | 担当 | 状態 |
|---|---|---|---|---|
| **0.7-1** | **実発注 E2E 検証**（最優先） | 招待済み自アカウントで **1GB/¥980 を実購入** → ①発行 ②QR/インストール・期限 ③`esim_links` に `provider:"esimaccess"`/`iccid`/`lpaProfile`/`providerRef` ④同期（`onEsimSyncRequested`）⑤残量アラート（`DATA_USAGE`/`VALIDITY_USAGE`）⑥topup（データ枯渇要・後回し可）⑦cancel→Stripe返金→返金メール | **あなた購入**／私検証 | ⏳ 未実施 |

> 監視（残高/死活/返金/通知）はデプロイ後の基本疎通は確認済み。**0.7-1 の実発注で最終確認**。

---

## SEO / GEO（詳細: [seo_plan.md](./seo_plan.md)）— Tier1 は私が即実装可
| 項目 | 内容 | 状態 |
|---|---|---|
| **OG画像 403 修正**（T1-2） | 本番 `og-image.png` が403でSNS/AIプレビュー画像なし。既存公開画像に暫定差替 or 1200×630用意 | ⏳ 要対応 |
| **hreflang整合**（A） | index.html hreflang/JSON-LD を実5言語(en/ko/zh-CN/zh-TW/th)へ（現状 en/ja で不整合） | ⏳ Tier1 |
| **AIクローラ明示**（G-2＋§8） | robots に OAI-SearchBot/Google-Extended/Applebot-Extended/CCBot ＋ 中国 Baiduspider/Bytespider/360/YisouSpider/PetalBot を Allow | ⏳ Tier1 |
| **HowTo構造化データ**（G-3） | eSIM設定4ステップを HowTo schema 化（AI引用向け） | ⏳ Tier1 |
| **sitemap lastmod**（T1-3） | lastmod付与・法務ページ追加 | ⏳ Tier1 |
| 動的head/プリレンダリング（Tier2/3） | 言語別metaやSSG＝SEO最大レバー・大工数 | 後日判断 |
| **中国本土アクセス性**（§8.0🔴） | Google依存(App Check/reCAPTCHA/Auth/googleapis)で本土遮断の恐れ。ICP+中国CDN+認証中国対応 or「本土は当面対象外」判断 | 🔲 方針決定要 |
| Search Console / 百度站长 登録（Tier4） | 計測の土台 | 🔲 あなた |

---

## v0.9 — 「固める」（GA前ハードニング）
| # | 項目 | 内容 | 担当 | 規模 |
|---|---|---|---|---|
| 0.9-1 | **S3 アクセシビリティ** | 購入ドロワー・問い合わせフォーム優先で aria/キーボード/フォーカス点検 | 私 | 中 |
| 0.9-2 | **firestore.rules: plans新フィールド検証** | provider/providerPlanId/wholesalePriceUsd 等の最小バリデーション（要承認・rules変更） | あなた承認/私実装 | 小 |
| 0.9-3 | **柱1 bappyWebhook 認証の結論** | 休眠だが `// TODO: Verify Bappy signature` 残存。(a)IP許可等で固める or (b)休眠受容を明記 | 私 | 小 |
| 0.9-4 | **ドキュメント最新化** | `api_functions.md`/`firestore_schema.md` を柱2後の実装に整合（provider系フィールド反映） | 私 | 小 |

---

## v1.0 — 「扉を開ける」（一般公開 GA）
| # | 項目 | 内容 | 担当 | 規模 |
|---|---|---|---|---|
| 1.0-1 | **招待制ゲート解除** | `requireAuth` の `isEmailAllowed` を一般開放へ（フラグ化 or 撤去）。要承認・段階公開も可 | あなた=Go/私=実装 | 小 |
| 1.0-2 | **公開前 最終QA** | 主要導線を全言語で通し確認（購入/ログイン/MyPage/topup/返金/問い合わせ）＋モバイル実機 | 私＋あなた | 中 |
| 1.0-3 | **集客・SEO・計測の点火** | SEO/GEO Tier1反映・OGP・sitemap・reCAPTCHA許可ドメイン・Analytics/Search Console最終確認 | 私＋あなた | 小 |
| 1.0-4 | **運用体制の確認** | ランブック最終版・アラート到達・返金/障害手順・残高チャージ運用 | あなた | 小 |

**GAゲート**：0.7-1実発注OK・招待制解除・全言語QA通過・計測稼働・運用手順確定。

---

## 任意（GA後でよい・バックログ）
| 項目 | 内容 |
|---|---|
| S5 lastSignedIn | 毎ログイン更新（現状ほぼ未更新） |
| S8 依存自動更新 | Dependabot/Renovate |
| S6' admin `any`削減 | 型安全性の底上げ |
| mailer/webhooks 追加リファクタ | v0.6で意図的に見送り（挙動不変だが決済経路のため慎重に） |
| 法務ページ日本語版化 | 現状は日本語ラベル併記の英語（実務上は概ね可） |

## 順序メモ
- **0.7-1（実発注）が最優先**：本番で未検証のまま売っている状態を解消する。
- **一般公開(v1.0-1)は最後**：0.7-1・v0.8(済)・v0.9・QA が揃ってから。
- SEO/GEO Tier1 は低リスク・いつでも相乗りデプロイ可。中国本土は §8.0 の方針決定が前提。
