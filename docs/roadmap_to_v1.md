# ロードマップ v0.6 → v1.0（一般公開）— 残タスク台帳

更新: 2026-07-08 ／ **本書は「これからやること」だけ**。完了項目は削除し、要点のみ現在地に集約（履歴は git / seo_plan.md 参照）。

## 現在地（v0.6・稼働中）
- ✅ **eSIMAccess 単一プロバイダで本番稼働**（発行/同期/topup/cancel・販売停止ガード・死活監視・多層防御Webhook・自動返金・§8 cancel連携）
- ✅ **大規模リファクタ P0–P5 本番反映済み**（db/callables分割・secrets一元化・admin 2タブ削除・PurchaseDrawer Context分割 等）
- ✅ **topupリトライ不具合 修正済み**（本番反映）
- ✅ **v0.8 完了**：チャット設置（chat.yah.mobi）／特商法整備（ボンファイア株式会社・運営統括責任者=山田一慶・連絡先 chat＋contact@mail.yah.mobi）／返金ポリシー一貫性／**網の事実訂正（KDDI→NTT docomo）**
- ✅ 返金（Lane A/B・5言語メール）／可観測性（Error Reporting＋S9到達＋S10死活）／運用ランブック
- ✅ **実発注E2E(0.7-1)成功（2026-07-08）**：実購入 `#la66cbNQt1azrnf9JwWx`（1GB/¥980 IIJ）→発行→QR→**実接続まで確認**
- ✅ **実発注で判明した改善3件を修正**（dev）：①eSIM期限表示（未有効化は Valid for/Install by）②topupエラー可視化 ③受付/発行メール6言語化。**topup全失敗の原因（Cloud Run allUsers invoker欠落→401）は本番IAMで復旧済み**
- ⚠️ **招待制ゲートON**：`allowed_emails` に無いユーザーは購入不可（＝一般公開前）

---

## v0.7 — 「動くことを証明する」✅ **完全クローズ（2026-07-08）**
- **0.7-1 実発注E2E**：実購入(¥980)→発行→QR→**実接続**→**topup実決済(+1GB反映)**→有効化検知→実期限表示、全て本番で確認。
- **0.7-2 実発注で発見した5件を修正・本番反映済み**：
  ①eSIM期限表示（未有効化=Valid for/Install by、有効化後=Expires 日時） ②注文系メール6言語化
  ③topup復旧（Cloud Run allUsers invoker欠落→401。IAM付与）＋エラー可視化（空catch廃止）
  ④topup注文UX（TOP-UPバッジ／「適用済み・再インストール不要」表示／topupプラン名リネーム／YOUR eSIMカード削除）
  ⑤eSIMAccess有効化検知（esimStatus IN_USE → lastActiveAt 記録。webhook＋sync両経路）
- 残タスク（任意）：cancel→自動返金の実e2e（Lane A自体は基本疎通済み）。

---

## SEO / GEO（詳細: [seo_plan.md](./seo_plan.md)）
**✅ Tier1 完了・本番反映（2026-07-08）**：hreflang 5言語整合／OG画像復旧(暫定)／robots に AI・Naver(Yeti)・中国クローラ明示／HowTo構造化データ／sitemap lastmod。

| 残項目 | 内容 | 状態 |
|---|---|---|
| **プリレンダリング**（Tier3-1） | Puppeteerビルド後プリレンダ実装済み。公開8ルート(/app・/{lang}/app×4・法務3)を言語別静的HTML化。dev検証：生HTMLに言語別 title/本文/hreflang(8)焼込み確認・各言語で正常描画。**本番反映は別途デプロイ指示待ち**（`npm run build && node scripts/prerender.mjs` → `firebase deploy --only hosting`） | ✅ 実装/dev検証済 → 🔲本番反映 |
| **専用OG画像 1200×630** | 現状は暫定でヒーロー画像流用。ブランドOGを作成しStorage公開 | 🔲 画像用意 |
| **Search Console / Naver Search Advisor / 百度站长 登録** | 計測＋各エンジンにsitemap提出（韓国=Naver必須） | 🔲 あなた |
| 動的head（Tier2） | react-helmet等で言語別 title/description/canonical（CSRのままの緩和策） | 後日判断 |
| **中国本土アクセス性**（§8.0🔴） | Google依存(App Check/reCAPTCHA/Auth/googleapis)で本土遮断の恐れ。ICP+中国CDN+認証中国対応 or「本土は当面対象外」判断 | 🔲 方針決定要 |

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
