# docs 索引（yah.mobile）

開発ルール（ブランチ運用・デプロイ・実装フロー）はリポジトリ直下の `CLAUDE.md` を参照。
実コードと記述が食い違う場合は**実コードを優先**。

## 計画（進行中）
- [plan_v0.51.md](./plan_v0.51.md) — v0.51 全体計画（ver.1）
- [plan_v0.51_v2.md](./plan_v0.51_v2.md) — v0.51 残タスク（最新・柱2進捗反映）
- [design_refactoring_v06.md](./design_refactoring_v06.md) — 大規模リファクタリング v0.6（P0〜P5）

## 運用ランブック（恒久）
- [runbook_solo_ops.md](./runbook_solo_ops.md) — solo運用（障害/返金/デプロイ/復旧）
- [runbook_esimaccess_launch.md](./runbook_esimaccess_launch.md) — eSIMAccess 本番切替手順（2026-07-08 実施済み）
- [system_fault_patterns_ja.md](./system_fault_patterns_ja.md) — 障害パターン
- [admin_security_custom_claims_manual_ja.md](./admin_security_custom_claims_manual_ja.md) — admin権限付与手順

## アーキテクチャ・リファレンス
- [api_functions.md](./api_functions.md) — Cloud Functions の入出力仕様（※柱2反映は追って更新）
- [firestore_schema.md](./firestore_schema.md) — Firestore スキーマ（※provider系フィールドは追って更新）
- [screen_flow.md](./screen_flow.md) — ルーティング・購入フロー図
- [current_specifications.md](./current_specifications.md) / [payment_specification.md](./payment_specification.md) — 全体仕様・課金
- [spec_refund.md](./spec_refund.md) — 返金機能仕様（Lane A/B・キルスイッチ）

## eSIMAccess（柱2・稼働中）
- [design_provider_abstraction.md](./design_provider_abstraction.md) — プロバイダ抽象＋単一プロバイダ化 設計（実装済み）
- [esimaccess_api_notes.md](./esimaccess_api_notes.md) — Partner API 確定仕様（署名/Webhook/cancel）
- [esimaccess_parallel_introduction.md](./esimaccess_parallel_introduction.md) — 導入検討（ver.1・歴史的経緯）

## 設計書（実装済み・トピック別）
- design_hardening_6.md / design_mypage_fixes.md / design_qr_client_render.md / design_esim_activated_at.md
- design_refund_strategy.md / design_s10_provider_healthcheck.md / design_s1_frontend_error_collection.md
- design_google_consent_domain.md / design_widget_login.md / design_contact_page.md
- design_db01_consent.md / design_db04_expirydate.md / design_pwa_refresh_ux.md
- design_manus_report_fixes.md / design_user_doc_consolidation.md / design_error_reporting_fixes.md

## chat（別プロジェクト yah-chat 連携）
- design_chat_fixes.md / design_decision_tree.md / design_escalation_via_contact.md
- design_measurement_loop.md / design_support_ai_chat_copy.md
- chat-yah-mobi-webhook-spec.md / chat_system_firestore_guidelines.md / chat_system_iam_security_guidelines.md

## アーカイブ
- [archive/](./archive/) — 役目を終えた文書（完了済み移行の記録・旧仕様・旧提案・Manus関連）。**参照のみ・更新しない。**
