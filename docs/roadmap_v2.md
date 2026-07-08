# ロードマップ v2 — GA（一般公開）までの残タスク

更新: 2026-07-09 ／ **本書は「残っていること」だけ**。完了項目は記載しない（履歴は git）。
現在地: **v0.8+ 本番稼働中**（eSIMAccess単一プロバイダ・購入/発行/topup/cancel/返金/監視・SEO/プリレンダ・chat/SSO・特商法・OG）。招待制ゲートON。

---

## v0.9 — 固める（GA前ハードニング）

| # | 項目 | 担当 | 状態 |
|---|---|---|---|
| 0.9-1 | **アクセシビリティ点検**：購入ドロワー・問い合わせフォーム優先（aria/キーボード/フォーカストラップ） | 私 | 🔲 |
| 0.9-2 | **firestore.rules: plans 新フィールド検証**（provider/providerPlanId/wholesalePriceUsd 等の最小バリデーション。要承認・rules変更・デプロイ指示） | あなた承認/私 | 🔲 |
| 0.9-4 | **ドキュメント最新化**（[api_functions](./api_functions.md)/[firestore_schema](./firestore_schema.md) を現行に整合） | 私 | 🔲 |

## v1.0 — 扉を開ける（GA）

| # | 項目 | 担当 | 状態 |
|---|---|---|---|
| 1.0-1 | **招待制ゲート解除**：`requireAuth` の `isEmailAllowed` を開放（フラグ化 or 段階公開）。要承認 | あなた=Go/私 | 🔲 |
| 1.0-2 | **公開前 全言語QA**：[qa_launch_checklist](./qa_launch_checklist.md) を通し（購入/ログイン/MyPage/topup/返金/問い合わせ＋モバイル実機） | 私＋あなた | 🔲 |
| 1.0-3 | **運用体制の確認**：[運用ランブック ver.1.1](./runbook_solo_ops.md)（残高チャージ・死活・返金/障害手順）を通し | あなた | 🔲 |

**GAゲート**：招待制解除・全言語QA通過・計測稼働・運用手順確定。

---

## あなた側の軽作業（GA前後どちらでも）
- 専用OG画像は反映済。**Bing Webmaster Tools** 登録（電話不要・繁体字SEO押上げ・任意）。
- Naver/百度は現地電話必須で登録不可 → プリレンダのオーガニック巡回に委ねる。

## 任意・バックログ（GA後でよい）
- 失効30日前の未有効化リマインダーメール（scheduled）。
- 専用OG画像の多言語版／A11yの網羅拡大（購入・問い合わせ以外の全画面）／`lastSignedIn` 毎ログイン更新／依存自動更新(Dependabot)／法務ページ完全日本語版。
- **アーキ改善（旧「潰すべきポイント」から集約）**：llms.txt 等 Cache-Control 確認／Analytics の BaaS化でFunctions削減（研究）／古いCallables残余の除去（軽微）。
- **Cloud Tasks 非同期リトライキュー＝不要**（現状の Firestore+scheduled リトライで十分・スケール時のみ再検討）。
- Firestore Rules 厳格化は **0.9-2 に集約**（ここには重複記載しない）。
- 中国本土＝**当面対象外で確定**（[seo_plan §8.0](./seo_plan.md)）。再参入は需要計測後。

## 方針メモ
- 残りは実質 **v0.9（固める）→ v1.0（開放）** のみ。一般公開は最後。
- rules/functions 変更・本番デプロイは**必ず明示指示**で（CLAUDE.md）。
