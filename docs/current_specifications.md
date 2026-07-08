# システム仕様書（最終版）：yah.mobile — BaaSファースト eSIM 販売プラットフォーム

最終更新: 2026-07-09。本書は現行アーキテクチャの仕様。詳細は各リンク先を正本とする。

## 0. 現状サマリ（2026-07-09・本番稼働）
- **構成**: React 19 + Vite 7（`client/`）→ Firebase Hosting（`https://yah.mobi`・多言語プリレンダ済）。バックエンド = Cloud Functions v2 / Firestore / Auth / Storage（プロジェクト `yah-mobile-v1-3ed24`・asia-northeast1）。**自前サーバなし（BaaS）**。
- **eSIMプロバイダ**: **eSIMAccess 単一**（IIJ系=NTT docomo網/JP-IP）。発行/同期/topup/cancel は Provider抽象（`providers/*`）経由。Bappy は休眠。
- **決済**: Stripe Checkout ＋ `stripeWebhook`。**返金**は Lane A(自動)/B(手動)→`executeRefund`→Stripe＋`charge.refunded` webhook確定・5言語メール。
- **監視**: `providerHealthCheck`(15分・残高/死活・販売停止ガード自動)・`hungOrderMonitor`・`esimRetryJob`・Error Reporting。
- **多言語**: en/ko/zh-CN/zh-TW/th（UI・メール・SEO）。中国本土は対象外（[seo_plan §8.0](./seo_plan.md)）。
- **チャット**: 別プロジェクト chat.yah.mobi（iframe埋込・SSO・AI/RAG・非履行）。
- **現状**: 招待制ゲートON（GA前）。実発注E2E成功済。

## 0.1 正本ドキュメント（このセットで全体を把握）
| テーマ | 正本 |
|---|---|
| 関数API | [api_functions.md](./api_functions.md) |
| データモデル | [firestore_schema.md](./firestore_schema.md) |
| 返金・障害の運用手順 | [refund_incident_procedures.md](./refund_incident_procedures.md) |
| 日次運用・残高チャージ | [runbook_solo_ops.md](./runbook_solo_ops.md)（運用ランブック ver.1.1） |
| 返金仕様/戦略 | [spec_refund.md](./spec_refund.md) / [design_refund_strategy.md](./design_refund_strategy.md) |
| テスト | [test_coverage.md](./test_coverage.md) |
| SEO/GEO | [seo_plan.md](./seo_plan.md) |
| 残タスク | [roadmap_v2.md](./roadmap_v2.md) |
| eSIMAccess API | [esimaccess_api_notes.md](./esimaccess_api_notes.md) |

> 以下は詳細アーキテクチャ解説（BaaS設計思想）。上記サマリが現状の要約。

---

## 1. 全体アーキテクチャ（純粋なBaaS構成）

アプリ全体は、不要な中継サーバーを完全に排除し、クライアントがデータベースと直接やり取りする **「極限サーバーレス直結モデル（BaaS）」** になっています。

* **フロントエンド (Vite/React)**: `client/` ディレクトリ。ビルドされた静的ファイルは **Firebase Hosting** によってグローバルCDNから爆速配信されます。自前サーバーによるレンダリング処理（Express）は介在しません。
* **データベース (Firestore)**: `firestore.rules` で保護された、すべての情報の「交差点」です。フロントエンドはAPIサーバーを介さず、FirestoreのSDKを使って直接データを読み書き（CRUD）します。
* **バックエンド (Cloud Functions)**: `functions/` ディレクトリ。フロントエンドから直接触れない「外部API連携」や「高権限が必要な処理」のみを担当する、イベント駆動のサーバーレス・プログラム群です。

---

## 2. BASSファースト達成状況と「残されたバックエンド処理」

「APIを廃止してフロントから直接Firestoreを操作する」というBaaSファーストの原則は、現状 **ほぼ100%達成** されています。
現在 Cloud Functions 側に残されている処理は、**「原理的にフロントエンド（BaaS）だけでは実装不可能な処理」のみ** に厳選されています。

### 現在 Functions に存在している処理とその理由（なぜBaaS化できないか）

1. **Stripe Webhook (`onRequest`)**
   - **理由**: Stripeの決済完了通知は、Stripeのサーバーから送られてきます。Stripeサーバーは直接Firestoreに書き込む機能を持っていないため、受け皿となるHTTPエンドポイント（Webhook）が絶対に必要です。
2. **eSIM発券処理 (Stripe Webhook内)**
   - **理由**: eSIMベンダー（Bappy）のAPIキーは秘匿情報であり、フロントエンドに持たせることはセキュリティ上不可能です。
3. **新規ユーザーの初期化トリガー (`onDocumentCreated`)**
   - **理由**: 新規登録時に「管理者のメールアドレスかどうか」を判定し、高権限である Firebase Auth の Custom Claims（`{ admin: true }`）を付与する処理は、強力な権限（Admin SDK）が必要なためバックエンドで行う必要があります。
4. **匿名アナリティクスイベントの受信 (`onRequest`)**
   - **理由**: ログインしていない誰でも書き込める仕様でFirestoreを直接開放すると、悪意のあるユーザーによってデータベースに無限にゴミデータを書き込まれる（DDoS攻撃や課金テロ）リスクがあります。そのため、Functionsで受け取り、回数制限やバリデーションを挟んでから書き込む設計にしています。
5. **AIボット向け `llms.txt` の動的生成 (`onRequest`)**
   - **理由**: 最新のプラン情報をデータベースから取得してテキストファイルとして整形し、AI検索エンジン（GooglebotやChatGPT）に返却するためにはサーバーサイドでの生成が必要です。

これら以外（例えば管理画面での注文ステータス変更、問い合わせの返信記録、商品プランの追加など）は、**すべてフロントエンドからの直接Firestore書き込み（BaaS）**に移行完了しています。

---

## 3. セキュリティモデル（Custom Claims への一本化）

Firestore を直接クライアントから操作するため、セキュリティの中核は `firestore.rules` に集約されています。

* **認証判定**: Firebase Auth の認証トークン（JWT）に埋め込まれた **Custom Claims** (`request.auth.token.admin == true`) を絶対的な権限の基準とします。
* **DBアクセスの削減**: 以前は「Firestoreのユーザー情報を読み取って管理者か判定する」処理がありましたが、Custom Claimsに一本化されたため、セキュリティルール内での余分なデータベース参照（`get()`など）が不要になり、コスト削減と速度向上が実現しました。

---

## 4. eSIMの購入・決済・発券の流れ（Webhook主導ルート）

Expressサーバーが消えたことで、よりシンプルで堅牢な決済ルートが確立されました。

```
【1. 注文する】(フロントエンド)
   Firestoreの `/orders` にステータス「保留中（pending）」のデータを作成。
        │
        ▼ (自動検知)
【2. 決済の準備】(Functions トリガー)
   `onOrderCreated` がStripeの「決済ページURL」を発行してDBに書き戻す。
        │
        ▼ (画面が自動検知)
【3. クレジットカード決済】(フロントエンド)
   画面はURLが書き込まれたのを検知し、自動的にStripe決済画面へリダイレクト。
        │
        ▼ (決済成功)
【4. eSIMの自動発行】(Functions Webhook)
   `webhooks.ts` の `stripeWebhook` がStripeから通知を受信。
   そのままBappy APIを叩いてeSIMを発券し、DB（/orders, /esim_links）を更新。
        │
        ▼ (画面が自動検知)
【5. 画面表示】(フロントエンド)
   Firestoreのリアルタイムリスナーが更新を検知し、画面にQRコードを表示。
```

---

## 5. 今後の改善（→ 正本は [roadmap_v2.md](./roadmap_v2.md)）

改善候補の管理は **[roadmap_v2.md](./roadmap_v2.md) に一本化**（二重管理回避）。旧「潰すべきポイント」の現状仕分けのみ以下に残す：

- **古いCallablesのクリーンアップ** → ほぼ完了（Q2死蔵コード削除・P3分割で整理済）。残余は軽微。
- **Firestore Rules 厳格化** → **roadmap 0.9-2**（plans新フィールド検証）に集約済。
- **llms.txt 等の Cache-Control 確認** → 任意・バックログ（動的関数配信のキャッシュ確認）。
- **Analytics の BaaS化（Functions削減）** → 任意・研究バックログ（優先低。現状の関数で動作）。
- **Cloud Tasks 非同期リトライキュー** → ❌ **不要**。現状は `esim_retry_jobs`＋`esimRetryJob`(scheduled) が永続・冪等・最大3回→自動返金で十分（実発注E2Eで実証）。Cloud Tasks はスケール最適化＝**高負荷時のみ再検討**。
