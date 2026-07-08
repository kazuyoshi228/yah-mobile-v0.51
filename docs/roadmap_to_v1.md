# ロードマップ v0.6 → v1.0（一般公開）— 残タスク台帳

更新: 2026-07-08 ／ **本書は「これからやること」だけ**。完了項目は削除し、要点のみ現在地に集約（履歴は git / seo_plan.md 参照）。

## 現在地（v0.8+・本番稼働中）
- ✅ **eSIMAccess 単一プロバイダで本番稼働**（発行/同期/topup/cancel・販売停止ガード・死活監視・多層防御Webhook・自動返金・§8 cancel連携）
- ✅ **大規模リファクタ P0–P5**／**topupリトライ不具合**／**v0.8**（chat設置・特商法・返金ポリシー・網訂正KDDI→NTT docomo）すべて本番反映済み
- ✅ **v0.7 実発注E2E 完全クローズ**：実購入→発行→QR→実接続→topup実決済(+1GB)→有効化検知→実期限表示。派生5件（期限表示/メール6言語/topup復旧IAM/topup UX/有効化検知）本番反映済み
- ✅ **SEO/GEO Tier1＋プリレンダリング(Tier3-1) 本番反映済み**：8ルート言語別静的HTML化・hreflang・robots・HowTo・sitemap
- ✅ **改善バッチ2 本番反映済み（2026-07-08）**：問い合わせ自動返信6言語／admin-orders 検索・ソート・返金／インストール期限の伝達(メール/FAQ/購入完了/マイページ)＋「削除しないで」注意／/contact プリフィル＋refundカテゴリ＋orderSnapshot／admin-inquiries 注文情報＋返金ボタン／**chat SSO**（親ログイン引継ぎ）＋AI返金フロー（注文確認→/contact引継ぎ・専用分岐は不採用）
- ⚠️ **招待制ゲートON**：`allowed_emails` に無いユーザーは購入不可（＝一般公開前）。テスト許可: `kazuyoshi.yamada@bonfire.co.jp` / `spsp109481@gmail.com`

---

## SEO / GEO — 残り（詳細: [seo_plan.md](./seo_plan.md)）
Tier1＋プリレンダリングは本番反映済み。残りは以下。

| 残項目 | 内容 | 状態 |
|---|---|---|
| **専用OG画像 1200×630** | 現状は暫定でヒーロー画像流用。ブランドOGを作成しStorage公開 | 🔲 画像用意 |
| ~~Google Search Console 登録~~ | sitemap `https://yah.mobi/sitemap.xml` 提出 | ✅ 完了（2026-07-08） |
| **Naver Search Advisor / 百度站长 登録** | **現地携帯電話が必要で登録不可**（Naver=韓国番号／百度=中国番号）。→ ①**Bing Webmaster Tools**（電話不要・Yahoo Taiwan/一部Bing系に有効）で代替登録 ②Naver/百度はプリレンダ済のため**オーガニック巡回に委ねる**（sitemap提出なしでもクロール可）③必要なら現地パートナー経由。百度は §8.0「中国本土対象外」判断と整合 | ⚠️ 登録不可→Bing代替＋オーガニック |
| 動的head（Tier2） | react-helmet等で言語別 title/description/canonical（CSRのままの緩和策） | 後日判断（プリレンダで主目的は達成） |
| ~~中国本土アクセス性~~（§8.0） | **✅ 方針確定（2026-07-08）：本土は対象外・香港/台湾/海外華人にフォーカス**（zh-TW=非遮断・既存実装で対応・ICP/中国CDN/百度不要）。zh-CN(簡体)は残す（SG/MY華人＋旅行中）。本格参入(ICP等)は本土需要の計測後に再判断 | ✅ 決定済（追加コード不要） |

---

## v0.9 — 「固める」（GA前ハードニング）
| # | 項目 | 内容 | 担当 | 規模 |
|---|---|---|---|---|
| 0.9-1 | **S3 アクセシビリティ** | 購入ドロワー・問い合わせフォーム優先で aria/キーボード/フォーカス点検 | 私 | 中 |
| 0.9-2 | **firestore.rules: plans新フィールド検証** | provider/providerPlanId/wholesalePriceUsd 等の最小バリデーション（要承認・rules変更） | あなた承認/私実装 | 小 |
| ~~0.9-3~~ | ~~柱1 bappyWebhook 認証の結論~~ | ✅ **(B)休眠受容で決定**（[design_bappy_webhook_dormant.md](./design_bappy_webhook_dormant.md)）。非財務・有効UUID知得が前提・認証責務はOMAX側。TODOを決定注記に置換（挙動不変・再デプロイ不要） | 私 | ✅ 完了 |
| 0.9-4 | **ドキュメント最新化** | `api_functions.md`/`firestore_schema.md` を柱2後の実装に整合（provider系フィールド反映） | 私 | 小 |
| 0.9-5 | **G: eSIMAccess 再インストール仕様の確認** | 同一QRの再DL可否・回数上限・削除後の復元手順を eSIMAccess に確認 → FAQ/発行メール文言を事実ベースに更新（現状は安全側で「削除しないで」記載済） | あなた確認/私反映 | 小 |

---

## v1.0 — 「扉を開ける」（一般公開 GA）
| # | 項目 | 内容 | 担当 | 規模 |
|---|---|---|---|---|
| 1.0-1 | **招待制ゲート解除** | `requireAuth` の `isEmailAllowed` を一般開放へ（フラグ化 or 撤去）。要承認・段階公開も可 | あなた=Go/私=実装 | 小 |
| 1.0-2 | **公開前 最終QA** | 主要導線を全言語で通し確認（購入/ログイン/MyPage/topup/返金/問い合わせ）＋モバイル実機 | 私＋あなた | 中 |
| 1.0-3 | **集客・SEO・計測の点火** | SEO/GEO Tier1反映・OGP・sitemap・reCAPTCHA許可ドメイン・Analytics/Search Console最終確認 | 私＋あなた | 小 |
| 1.0-4 | **運用体制の確認** | ランブック最終版・アラート到達・返金/障害手順・残高チャージ運用 | あなた | 小 |

**GAゲート**：0.7-1実発注OK(済)・招待制解除・全言語QA通過・計測稼働・運用手順確定。

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
- **残るは実質 v0.9（固める）→ v1.0（招待制解除＋QA＋点火）**。0.7・v0.8・SEO/プリレンダ・batch2 は本番反映済み。
- **一般公開(v1.0-1)は最後**：v0.9・全言語QA が揃ってから。段階公開（allowed_emails 緩和）も選択肢。
- 中国本土は §8.0 の方針決定が前提。Google Search Console は登録済。Naver/百度は現地電話必須で登録不可（Bing Webmaster 代替＋プリレンダのオーガニック巡回に委ねる）。
