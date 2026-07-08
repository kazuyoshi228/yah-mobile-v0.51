# 運用ランブック（solo運用） — yah.mobile

恒久・生きた文書。障害/返金/デプロイ/復旧の**手順書**。バス係数=1対策。
最終更新: 2026-07-07 ／ 対象: eSIM本体（`yah-mobile-v0.51`）
関連: [plan_v0.51_v2.md](./plan_v0.51_v2.md)（残タスク）／ CLAUDE.md（運用ルール）

> 🚨 大原則：**本番データを変更する前に読み取り専用で現状確認**。**本番デプロイ/実返金はユーザー（自分）の明示判断で**。**シークレットは貼らない・コミットしない**。

---

## 0. システム構成（頭に入れる）

| 要素 | 内容 |
|---|---|
| フロント | React 19 + Vite 7（`client/`）。本番 `https://yah.mobi` |
| バックエンド | Firebase（Functions v2 / Firestore / Auth / Storage / Hosting）。プロジェクト `yah-mobile-v1-3ed24` |
| eSIMプロバイダ | Bappy/OMAX（`api.omaxtelecom.com` ／ 認証 Keycloak `id.omaxtelecom.com`）。※将来 eSIMAccess 併走（柱2） |
| 決済 | Stripe（Checkout ＋ webhook `https://yah.mobi/api/stripe/webhook`） |
| 監視 | `providerHealthCheck`（15分・Bappy認証ping）／ Cloud Error Reporting ／ `notifyOwner`→OWNER_EMAIL |

**⚠️ 同一Firebaseプロジェクトをチャット（`yah-chat-webdev`）と共有**。リソースは名前空間分離（eSIM=codebase "default"・defaultDB・yah.mobiサイト／chat=codebase "chat"・"chat"DB・chat-yah-mobi-v2サイト）。**デプロイ/gitは必ず正しいディレクトリで**（取り違え厳禁）。

### 重要URL
- 本番サイト：https://yah.mobi ／ 管理画面：https://yah.mobi/admin
- Firebase Console：https://console.firebase.google.com/project/yah-mobile-v1-3ed24
- Error Reporting：https://console.cloud.google.com/errors?project=yah-mobile-v1-3ed24
- Stripe ダッシュボード：https://dashboard.stripe.com
- devプレビュー：https://yah-mobile-v1-3ed24--dev-tvnc2fob.web.app

---

## 1. アラートが来たとき（トリアージ）

通知は **OWNER_EMAIL（kazuyoshi.yamada@bonfire.co.jp）宛メール**＋（設定次第で forge/slack）に届く。

### 🚨「Bappy認証 ダウン（発行系停止のおそれ）」= 最優先
`providerHealthCheck` が Bappy 認証失敗を検知。**発行/topup/同期が止まる**。→ §2.1 の復旧手順へ。

### 「eSIM発行 最終失敗 — 注文 #…」
リトライ尽きて発行できなかった注文。返金は自動（Lane A）でトリガー済みのはず。→ §3 で返金状況を確認。Bappy側原因も§2.1で調査。

### 「宙吊り注文 N件（provisioning が30分以上）」
`hungOrderMonitor` 検知。どのジョブにも拾われず放置。→ §2.2。

### Error Reporting「新規エラー」メール
まず**発生源（関数名）でeSIMかチャットか仕分け**（§4）。チャット側（`onragdocumentwritten`/`onvisitormessagecreated`/`yah-chat-webdev`）は別プロジェクト案件。

---

## 2. 障害と復旧手順

### 2.1 プロバイダ認証失効（OMAX_CLIENT_ID / SECRET）★2026-07に実発生
**症状**：Bappy 401 `invalid_client`／発行・topup・同期が全滅／死活アラート。
**原因例**：Secret Manager 貼り付け時の**末尾改行/空白混入**（2026-07-03の事故がこれ。約4日ダウン）。
**復旧**：
1. 読み取りで疑いを確認（Error Reporting で `fetchNewToken`/`invalid_client`、死活アラート本文）。
2. Secret を**トリム済みの値で更新**（末尾改行を絶対に入れない）：
   ```bash
   cd ~/Downloads/yah-mobile-v4-dev_202607031209
   printf '%s' 'THE_CLIENT_ID' | firebase functions:secrets:set OMAX_CLIENT_ID   # 改行を入れない
   # または対話式: firebase functions:secrets:set OMAX_CLIENT_ID（貼り付け時に改行を含めない）
   ```
3. Secret を使う関数を**再デプロイ**（新バージョンをバインド）：`firebase deploy --only functions`。
4. 検証：Functionsログで `[providerHealthCheck] Bappy auth OK` を確認／テスト購入で発行成功。
> 教訓：Secret は末尾改行に注意。死活監視（S10）＋メール到達（S9）で「4日気づかない」は再発防止済み。

### 2.2 eSIM発行が失敗している
1. `/admin → Orders` で該当注文の `status` 確認（`pending_retry`/`failed`）。
2. 自動リトライ（`esimRetryJob` 5分毎）を待つ（※旧 `/admin` 障害タブの「今すぐリトライ」は 2026-07-08 リファクタ P1-3 で廃止。リトライ状況は Firestore Console の `esim_retry_jobs` / `incident_logs` で確認）。
3. 恒久失敗なら §2.1（プロバイダ認証）か Bappy 側障害を疑う。課金済みで提供不能なら**返金**（§3）。

### 2.3 Stripe webhook 不達（課金されたのに反映されない）
1. Stripe ダッシュボード → Developers → Webhooks → エンドポイント `.../stripeWebhook` の**配信ログ**を確認（失敗/リトライ）。
2. 購読イベントに `checkout.session.completed` と `charge.refunded` があるか。
3. 署名シークレット（`STRIPE_WEBHOOK_SECRET`）が最新か。

### 2.4 メール送信失敗（発行/返金/アラートメールが届かない）
- eSIM側は **nodemailer（GMAIL_USER/GMAIL_PASS）**。Error Reporting で eSIM 関数由来の送信エラーを確認。
- ※「Gmail送信エラー: GaxiosError」はチャット側（別実装）。混同しない（§4）。

### 2.5 App Check / reCAPTCHA で購入・問い合わせが失敗
- 新ドメイン（devチャンネルURL等）を reCAPTCHA Enterprise の許可ドメインに追加。
- 本番 yah.mobi は登録済み。

---

## 3. 返金対応

**入口は3つ、確定は Stripe `charge.refunded` webhook に一元化**（どの経路でも注文更新＋顧客への5言語メール）。
- **Lane A 自動**：発行/topup 最終失敗（当社側事由）で自動全額返金。
- **Lane B 手動**：`/admin → Refunds` タブ →「返金する」ボタン（`status=failed` を候補表示）。
- **Stripe 直接**：ダッシュボードで手動返金しても webhook 経由でアプリに反映。

**手順（手動）**：
1. `/admin → Refunds` を開く。
2. 返金候補（`status=failed`）から対象を確認（金額・注文ID）。
3. 「返金する」→ 確認 → 実行。数秒で `refundStatus=refunded` バッジ＋顧客メール。

**キルスイッチ（自動返金の緊急停止）**：`/admin → Refunds` タブ上部トグル（`system_config/refunds.autoRefundEnabled`）。障害で自動返金を止めたいとき即OFF（再デプロイ不要）。

---

## 4. Error Reporting の見方（eSIM / チャット仕分け）

同一プロジェクト共有のため両方のエラーが混在。**発生源（関数名）で仕分ける**：
- **eSIM（対応対象）**：`stripeWebhook` / `esimRetryJob` / `providerHealthCheck` / `onEsimSyncRequested` / `submitContactInquiry` / `ordersInit*` / `adminRefundOrder` など（`chat:` 無し）。
- **チャット（別プロジェクト `yah-chat-webdev` で対応）**：`onragdocumentwritten`（RAG Embedding）／`onvisitormessagecreated`（AI応答・chat Gmail）／`yah-chat-webdev`（drizzle-orm）など。
- クライアント発の実行時エラーは `[clientError]` プレフィックス（フロントエラー収集）。

---

## 5. デプロイ手順（取り違え厳禁）

**必ず eSIM ディレクトリで**：`cd ~/Downloads/yah-mobile-v4-dev_202607031209`

| 対象 | コマンド | 注意 |
|---|---|---|
| dev確認（プレビュー） | `firebase hosting:channel:deploy dev --expires 30d` | フロントのみ。backendは本番共有 |
| 本番 functions | `firebase deploy --only functions` | codebase "default" のみ＝chat関数は無傷 |
| 本番 rules | `firebase deploy --only firestore:rules` | |
| 本番 hosting | `npm run build && firebase deploy --only hosting` | 先に `npm run build` |

- **ブランチ**：開発は `dev`。本番リリース時のみ `dev→main` マージ。
- **ビルド**：Node 22（`~/node22/bin`）。ルートは pnpm、`functions/` は npm。
- **リリース記録**：本番反映後 `git checkout main && git merge dev && git push origin main && git checkout dev`。
- **firebase 認証切れ**（`invalid_rapt`/reauth）：`firebase login --reauth`（自分で実行）。
- **auth 系のロールバック**：`VITE_FIREBASE_AUTH_DOMAIN` を firebaseapp.com に戻して再ビルド/デプロイ。

---

## 6. Secret 管理

- 一覧/設定：`firebase functions:secrets:set NAME` / `firebase functions:secrets:access NAME`。
- **末尾改行を入れない**（§2.1 の事故原因）。`printf '%s'` で流し込むと安全。
- 変更後は**該当関数を再デプロイ**しないと反映されない。
- 主なSecret：`OMAX_CLIENT_ID/SECRET`・`STRIPE_SECRET_KEY/WEBHOOK_SECRET`・`GMAIL_USER/PASS`・`OWNER_EMAIL`・`BUILT_IN_FORGE_API_KEY`・`SLACK_WEBHOOK_URL`。
- **シークレットはチャット/コミットに貼らない**。GitHub PAT を使わず SSH（`git@github.com:...`）。

---

## 7. 本番データの確認（読み取り専用）

変更前に必ず現状を読む。テンプレ：`scripts/inspect-order-*.mjs`（firebase-admin ＋ ADC or `SA_KEY_PATH`）。
```bash
export PATH="$HOME/node22/bin:$PATH"
export GOOGLE_CLOUD_PROJECT=yah-mobile-v1-3ed24
node scripts/inspect-order-bwov753.mjs   # 例：注文/eSIM/topupプランの状態を読むだけ
```
- 移行/変更スクリプトは **`--dry` で対象0件を確認**してから実行。0件なら実行しない。

---

## 8. 定期チェック（solo）

**日次（アラートがある日）**
- OWNER_EMAIL 受信箱：死活/最終失敗/宙吊りアラートの有無。
- Error Reporting：eSIM由来の新種エラー。

**週次**
- `providerHealthCheck` ログが `OK` を刻んでいるか（監視自体の健全性）。
- Stripe：返金/係争（dispute）の有無。
- 依存更新（S8導入後は Dependabot PR を確認）。

**リリース前**
- `tsc --noEmit`／`vitest`（client/functions/rules）／`npm run build`。
- dev チャンネル or 本番で該当機能を目視確認。

---

## 9. エスカレーション先

- **OMAX/Bappy（発行・プロバイダ）**：技術連絡先メール（`OMAX_TECH_EMAIL`）。発行系ダウンはここへ。
- **Stripe**：ダッシュボード内サポート（決済・返金・webhook）。
- **Firebase/GCP**：コンソールのサポート（プロジェクト `yah-mobile-v1-3ed24`）。
- **チャット（別PJ）**：`yah-chat-webdev` リポジトリで対応。

---

## 10. 付録：既知の落とし穴
- Secret の**末尾改行**（→ 401 大障害）。
- **デプロイ/gitのディレクトリ取り違え**（eSIM ⇄ chat 同一プロジェクト共有）。
- OAuth の URI 追加は**反映に5分〜数時間**（`redirect_uri_mismatch` は伝播待ちの可能性）。
- dev チャンネルは**backendが本番共有**（devでの購入も本番データに書く）。
- **本番デプロイ後は必ず** `node scripts/smoke_prod.mjs`（invoker欠落=topup401・メタ回帰を検知）。

---

## 11. 主要ドキュメント索引（迷ったらここから）
> 現状の正本。本ランブックは障害/復旧の**手順**、以下が各テーマの詳細。

**運用**
- [ops_daily_runbook.md](./ops_daily_runbook.md) — 日次タスク表・**残高オートチャージ**・デプロイ後スモーク（日次の相棒）
- [refund_incident_procedures.md](./refund_incident_procedures.md) — **返金(Lane A/B)＋症状別 障害フロー**
- [qa_launch_checklist.md](./qa_launch_checklist.md) — 公開前 全言語QA
- `../CLAUDE.md` — 運用ルール（デプロイ/ブランチ/禁止事項）

**仕様・設計**
- [current_specifications.md](./current_specifications.md) — システム仕様（最終版・正本索引）
- [api_functions.md](./api_functions.md) — Cloud Functions API（21関数）
- [firestore_schema.md](./firestore_schema.md) — Firestore スキーマ（23コレクション）
- [spec_refund.md](./spec_refund.md) / [design_refund_strategy.md](./design_refund_strategy.md) — 返金 仕様/戦略
- [payment_specification.md](./payment_specification.md) — 決済仕様
- [esimaccess_api_notes.md](./esimaccess_api_notes.md) — eSIMAccess API メモ

**品質・計画**
- [test_coverage.md](./test_coverage.md) — テスト棚卸し（rules36/functions80/client34）
- [seo_plan.md](./seo_plan.md) — SEO/GEO（中国本土は§8.0で対象外確定）
- [roadmap_v2.md](./roadmap_v2.md) — **残タスク台帳（v0.9→v1.0）**
- [system_fault_patterns_ja.md](./system_fault_patterns_ja.md) — 障害/返金パターン定義

> ⚠️ 本ランブック(§0-2)は 2026-07 時点の記述で **Bappy/OMAX 前提が一部残存**。現行は **eSIMAccess 単一**。プロバイダ非依存の手順は有効だが、Bappy固有(§2.1 OMAX認証失効 等)は現行では発生しない。最新の運用は §11 のリンク先を正とする。
