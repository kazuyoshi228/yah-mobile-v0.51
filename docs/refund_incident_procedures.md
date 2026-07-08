# 返金・障害対応手順（運用MD）

更新: 2026-07-09 ／ 対象: yah.mobile 本番。関連: [運用ランブック ver.1.1](./runbook_solo_ops.md)｜[返金仕様](./spec_refund.md)｜[障害パターン定義](./system_fault_patterns_ja.md)
本書は**運用者が実際に踏む手順**。設計/仕様の詳細は上記リンク。

> 大原則：**お客様都合の返金は不可**。返金対象は「決済完了したが**当社側の問題**でサービス提供できない」ケースに限定。

---

## A. 返金の仕組み（2レーン）
| レーン | 誰が | いつ | 実装 |
|---|---|---|---|
| **Lane A（自動）** | システム | 発行が最終失敗（`esimRetryJob` 3回失敗）等の当社起因 | `executeRefund(orderId,"system_failure")`。**キルスイッチ**（/admin トグル→`system_config/refunds.autoRefundEnabled`）で即停止可 |
| **Lane B（手動）** | 管理者 | 個別判断（問い合わせ経由等） | /admin/orders or /admin/inquiries の「返金する」→ `adminRefundOrder(orderId,"manual")`。キルスイッチ対象外 |

**共通の実挙動**（`executeRefund`）:
1. 冪等ガード（`refundStatus`=processing/refunded は再返金しない）。
2. **未使用eSIMは provider cancel**（eSIMAccess・残高へ原価回収。使用済みは自動スキップ＝顧客返金には影響なし）。
3. Stripe 全額返金を発行 → **確定・`status="refunded"`・顧客への5言語メールは `charge.refunded` webhook（`handleChargeRefunded`）が実行**。

→ つまり返金ボタンは「開始」。確定と通知は webhook 経由で非同期に入る。

---

## B. 手動返金の手順（Lane B）
1. 対象注文を特定（/admin/orders 検索 or /admin/inquiries の注文情報）。
2. **返金妥当性を確認**：当社起因か？ 使用済みでないか？（使用済みは原価回収不可だがStripe返金は可）。
3. 「返金する」→ 二重確認ダイアログ → 実行。
4. 数十秒後、Stripe webhook で `status=refunded` になり顧客へメール。/admin で反映を確認。
5. 問い合わせ起因なら inquiry を resolved に。

**返金できない/エラー時**: refundStatus が `failed` → Stripe ダッシュボードで直接返金 → 手動で注文に記録。原因を [障害パターン](./system_fault_patterns_ja.md) に照らす。

---

## C. 障害対応フロー（症状別）
| 症状 | 一次確認 | 対応 |
|---|---|---|
| **購入できない（全ユーザー）** | providerHealthCheck 通知／eSIMAccess残高 | 残高$0→**チャージ**（[運用ランブック §5](./runbook_solo_ops.md)）。API down→回復待ち（ガード自動）。招待制なら allowed_emails |
| **購入できない（特定ユーザー）** | 招待制ゲート | `allowed_emails` に追加 |
| **決済OKだが発行されない** | /admin/orders で status | provisioning滞留→`esimRetryJob`が再試行。最終失敗→failed＋自動返金(Lane A)。手動督促は onEsimSyncRequested（マイページの再同期） |
| **eSIMが「Ready to Install」のまま** | lastActiveAt | 有効化webhook(IN_USE)未達→マイページ再読込で自動sync。仕様は [[esimaccess-expirydate-install-deadline]] |
| **topupできない** | Cloud Run invoker | callable の allUsers invoker 欠落→401（[[topup-iam-invoker-401]]）。IAM付与で復旧 |
| **返金が確定しない** | Stripe webhook 到達 | `charge.refunded` が来ているか。未達なら Stripe 側で手動返金＋記録 |
| **Functions例外多発** | Cloud Error Reporting | 該当関数のログ→原因特定→修正→スコープ付きデプロイ |

**エスカレーション**: プロバイダ起因（発行/残高/API）は eSIMAccess サポート（ICCID＋スクショ添付）。決済は Stripe ダッシュボード。

---

## D. やってはいけない
- 使用済みeSIMへの二重返金（冪等ガードがあるが手動Stripe返金と併用時は注意）。
- Lane A キルスイッチをONのまま放置（当社起因の未返金が溜まる）。障害収束後は必ず戻す。
- rules/functions/secrets を無断変更・無断デプロイ（CLAUDE.md）。
