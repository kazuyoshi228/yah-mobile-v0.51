# 運用ランブック ver.1.1 — yah.mobile（統合版）

恒久・生きた文書。**日次オペレーション＋障害/返金/デプロイ/復旧の手順書**（旧「運用ランブック(最終版)」と「solo運用ブック」を統合）。バス係数=1対策。
最終更新: 2026-07-09 ／ 現行: **eSIMAccess 単一プロバイダ**（Bappy は休眠）。関連: CLAUDE.md（運用ルール）／ §13 索引。

> 🚨 大原則：**本番データ変更前に読み取り専用で現状確認**／**本番デプロイ・実返金は自分の明示判断で**／**シークレットは貼らない・コミットしない**。

---

## 0. システム構成
| 要素 | 内容 |
|---|---|
| フロント | React 19 + Vite 7（`client/`）→ Firebase Hosting。本番 `https://yah.mobi`（多言語プリレンダ） |
| バックエンド | Firebase（Functions v2 / Firestore / Auth / Storage）。プロジェクト `yah-mobile-v1-3ed24`・`asia-northeast1` |
| eSIMプロバイダ | **eSIMAccess 単一**（IIJ系=NTT docomo網/JP-IP）。発行/同期/topup/cancel は Provider抽象。Bappy は休眠 |
| 決済 | Stripe（Checkout ＋ webhook `.../stripeWebhook`。`charge.refunded` で返金確定） |
| 監視 | `providerHealthCheck`（15分・**残高**/死活・販売停止ガード自動）／`hungOrderMonitor`／`esimRetryJob`／Error Reporting／`notifyOwner`→OWNER_EMAIL |

**⚠️ 同一Firebaseプロジェクトをチャット（`yah-chat-webdev`）と共有**。名前空間分離（eSIM=codebase "default"・defaultDB・yah.mobiサイト／chat=codebase "chat"・"chat"DB・chat-yah-mobi-v2サイト）。**デプロイ/gitは必ず正しいディレクトリで**（取り違え厳禁）。

### 重要URL
- 本番 https://yah.mobi ／ 管理 https://yah.mobi/admin
- Firebase Console https://console.firebase.google.com/project/yah-mobile-v1-3ed24
- Error Reporting https://console.cloud.google.com/errors?project=yah-mobile-v1-3ed24
- Stripe https://dashboard.stripe.com ／ eSIMAccess パートナーポータル https://esimaccess.com
- devプレビュー https://yah-mobile-v1-3ed24--dev-tvnc2fob.web.app

---

## 1. 毎日のデイリータスク（監視のみ・5分）
| タスク | 見る場所 | 基準／アクション |
|---|---|---|
| オーナー通知メール | 受信箱（OWNER_EMAIL）/Slack | 死活・残高・最終失敗・宙吊りの有無 → 該当は §2〜§5 |
| 失敗/滞留注文 | /admin/orders（status=failed/provisioning/pending_retry） | failed=自動返金済か確認。provisioning滞留→§3.2 |
| 返金の当日分 | /admin/orders（refundStatus）or Stripe | processing のまま滞留がないか |
| 問い合わせ新着 | /admin/inquiries（pending） | refund系は注文情報を見て §4 |

> 残高は**オートチャージ稼働中**のため日次の手動作業は不要（§5）。

---

## 2. アラート・トリアージ
通知は **OWNER_EMAIL（kazuyoshi.yamada@bonfire.co.jp）宛メール**＋（設定次第で slack）に届く。

| アラート | 意味 | 対応 |
|---|---|---|
| 🚨 **eSIMAccess API down / 販売停止** | 疎通失敗→販売停止ガード自動ON。発行が止まる | §3.1。回復で自動解除（「eSIMAccess API が回復しました」通知） |
| 🟡 **残高 < $20** | **オートチャージが効いていない兆候**（バックストップ） | §5（支払い方法/カード期限を確認） |
| **eSIM発行 最終失敗 — 注文#…** | リトライ尽きた。自動返金(Lane A)済のはず | §4で返金確認。原因は §3.1/§3.2 |
| **宙吊り注文 N件（provisioning滞留）** | どのジョブにも拾われず放置 | §3.2 |
| Error Reporting「新規エラー」 | 例外 | §6でeSIM/チャット仕分け |

---

## 3. 障害と復旧手順

### 3.1 プロバイダ障害／購入できない（全員）
- **残高$0** → §5（平時はオートチャージで回避）。補充後、残高回復で販売停止ガード自動解除。
- **eSIMAccess API down / 認証失効** → Error Reporting で `esimaccessWebhook`/`providerHealthCheck` のエラーを確認。Secret（`ESIMACCESS_ACCESS_CODE`/`ESIMACCESS_SECRET_KEY`/`ESIMACCESS_WEBHOOK_TOKEN`）の**末尾改行/空白混入**を疑う（→§8の手順でトリム更新＋再デプロイ）。回復まで販売停止ガードが自動で購入を守る。
- **招待制で買えない（特定ユーザー）** → `allowed_emails` に追加。

> ★教訓（2026-07 実発生）：Secret の**末尾改行**でプロバイダ 401 → 数日ダウン。`printf '%s'` で流し込む。死活監視(S10)＋メール到達(S9)で再発防止済み。

### 3.2 eSIM発行が失敗/滞留している
1. /admin/orders で該当 `status`（`pending_retry`/`failed`/`provisioning`）。
2. 自動リトライ（`esimRetryJob`）を待つ。状況は Firestore Console の `esim_retry_jobs`/`incident_logs`。
3. 恒久失敗なら §3.1 を疑い、課金済みで提供不能なら**返金**（§4）。
4. 個別の再同期はマイページの「Refresh data usage」（`onEsimSyncRequested`）。

### 3.3 その他症状 → [refund_incident_procedures.md §C](./refund_incident_procedures.md)
Stripe webhook 不達・メール未達・App Check/reCAPTCHA・topup 401（invoker欠落）・Ready to Install のまま 等は**返金/障害手順の症状別表**を参照。

---

## 4. 返金対応
**入口3つ、確定は Stripe `charge.refunded` webhook に一元化**（注文更新＋顧客5言語メール）。
- **Lane A 自動**：発行/topup 最終失敗（当社事由）で自動全額返金。
- **Lane B 手動**：/admin/orders または /admin/inquiries の「返金する」→ 二重確認 → 実行（数秒で `refundStatus=refunded`＋メール）。
- **Stripe 直接**：ダッシュボード手動返金も webhook で反映。
- **キルスイッチ**：/admin/orders(Refunds) 上部トグル（`system_config/refunds.autoRefundEnabled`）で自動返金を即停止（再デプロイ不要）。障害収束後は必ず戻す。
- 詳細手順・やってはいけない事は [refund_incident_procedures.md](./refund_incident_procedures.md)。

---

## 5. 残高（eSIMAccess・オートチャージ稼働 🟢）
- **オートチャージ設定済**：残高 **≤ $100 で自動補充**（一次防衛）。**平時は手動チャージ不要・監視のみ**。
- 当社コードの **$20未満警告**（`providerHealthCheck`・`LOW_BALANCE_USD`）＝**オートチャージ失敗の検知バックストップ**。
- **$20警告が来たら**：eSIMAccess ポータルで**支払い方法/オートチャージ設定/カード有効期限**を確認 → 必要なら手動 Deposit で応急補充。$0で販売停止した場合は補充後に自動解除（解除されなければ §3.1）。
- **月次**：オートチャージ発動履歴＋支払い方法の有効性（カード期限切れ事故の予防）。繁忙期前は上限/補充額を見直し。

---

## 6. Error Reporting の仕分け（eSIM / チャット）
同一プロジェクト共有のため両方混在。**発生源（関数名）で仕分ける**：
- **eSIM（対応対象）**：`stripeWebhook`/`esimaccessWebhook`/`esimRetryJob`/`providerHealthCheck`/`onEsimSyncRequested`/`ordersInit*`/`adminRefundOrder`/`submitContactInquiry` など。
- **チャット（別PJ `yah-chat-webdev`）**：`onvisitormessagecreated`/`onragdocumentwritten`/`ssoExchange`/`claimSession` など。
- フロント発は `[clientError]` プレフィックス（`clientErrorLog`収集）。

---

## 7. デプロイ手順（取り違え厳禁）＋デプロイ後スモーク
**必ず eSIM ディレクトリで**：`cd ~/Downloads/yah-mobile-v4-dev_202607031209`

| 対象 | コマンド |
|---|---|
| dev確認（プレビュー） | `firebase hosting:channel:deploy dev --expires 30d` |
| 本番 functions | `firebase deploy --only functions:<name>`（codebase "default"・スコープ付き） |
| 本番 rules | `firebase deploy --only firestore:rules` |
| 本番 hosting | `npm run build && node scripts/prerender.mjs && firebase deploy --only hosting` |

- 🟢 **【必須】本番デプロイ後は必ず** `node scripts/smoke_prod.mjs`（読み取り専用）。
  - 検査：全callableの `allUsers` invoker（**topup 401 再発防止**）／OG画像200／`/app`・各言語プリレンダの title/og:image 回帰／llms.txt。FAIL は修正→再デプロイ。invoker確認は ADC 要（`gcloud auth application-default login`）。
- **ブランチ**：開発は `dev`。本番リリース時のみ `dev→main`。認証切れ（`invalid_rapt`/reauth）は `firebase login --reauth`。
- **ビルド**：Node 22（`~/node22/bin`）。ルートは pnpm、`functions/` は npm。

---

## 8. Secret 管理
- 設定/確認：`firebase functions:secrets:set NAME` / `:access NAME`。**末尾改行を入れない**（`printf '%s' '値' | firebase functions:secrets:set NAME`）。変更後は**該当関数を再デプロイ**。
- 主なSecret：`ESIMACCESS_ACCESS_CODE`/`ESIMACCESS_SECRET_KEY`/`ESIMACCESS_WEBHOOK_TOKEN`・`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`・`GMAIL_USER`/`GMAIL_PASS`・`OWNER_EMAIL`・`BUILT_IN_FORGE_API_KEY`・`SLACK_WEBHOOK_URL`。
- シークレットはチャット/コミットに貼らない。GitHub は SSH。

---

## 9. 本番データの確認（読み取り専用）
変更前に必ず現状を読む（firebase-admin ＋ ADC）。
```bash
export PATH="$HOME/node22/bin:$PATH"
# 例：scripts/ に read-only 検査スクリプトを書いて実行（注文/eSIM/プラン/残高の状態を読むだけ）
```
- 移行/変更スクリプトは **`--dry` 相当で対象0件を確認**してから実行。0件なら実行しない。
- ADC 失効（`invalid_rapt`）は `gcloud auth application-default login`（書き込み系はこれが必要）。

---

## 10. 定期チェック
- **週次**：providerHealthCheck が `OK` を刻んでいるか／Stripe の返金・係争(dispute)／失敗率・問い合わせ傾向／依存更新(Dependabot)。
- **月次**：オートチャージ履歴＋支払い方法の有効性／Stripe売上と注文突合／残高の減り方 vs 発行数。
- **リリース前**：`tsc --noEmit`／`vitest`（client/functions/rules）／`npm run build`／dev目視。

---

## 11. エスカレーション先
- **eSIMAccess（発行・残高・API）**：パートナーポータル/サポート（ICCID＋スクショ添付）。
- **Stripe**：ダッシュボード内サポート（決済・返金・webhook）。
- **Firebase/GCP**：コンソールのサポート（`yah-mobile-v1-3ed24`）。
- **チャット（別PJ）**：`yah-chat-webdev` リポジトリで対応。

---

## 12. 既知の落とし穴
- Secret の**末尾改行**（→ 401 大障害）。`printf '%s'` で流す。
- **デプロイ/gitのディレクトリ取り違え**（eSIM ⇄ chat 同一プロジェクト共有）。
- 新規 gen2 callable は **`allUsers` invoker が取りこぼされ 401**（topup で実発生）→ **デプロイ後スモークで検知**（§7）。
- OAuth の URI 追加は**反映に5分〜数時間**。dev チャンネルは **backendが本番共有**（devでの購入も本番データに書く）。
- **eSIMAccess `expiryDate` は未有効化でも null でない**（＝インストール期限・約6ヶ月）。UIは `isEsimActivated()` で分岐（[firestore_schema](./firestore_schema.md)）。

---

## 13. 主要ドキュメント索引（迷ったらここから）
**運用**
- [refund_incident_procedures.md](./refund_incident_procedures.md) — **返金(Lane A/B)＋症状別 障害フロー**
- [qa_launch_checklist.md](./qa_launch_checklist.md) — 公開前 全言語QA
- `../CLAUDE.md` — 運用ルール（デプロイ/ブランチ/禁止事項）

**仕様・設計**
- [current_specifications.md](./current_specifications.md) — システム仕様（最終版・正本索引）
- [api_functions.md](./api_functions.md) — Cloud Functions API（21関数）
- [firestore_schema.md](./firestore_schema.md) — Firestore スキーマ（23コレクション）
- [spec_refund.md](./spec_refund.md) / [design_refund_strategy.md](./design_refund_strategy.md) — 返金 仕様/戦略
- [payment_specification.md](./payment_specification.md) — 決済仕様 ／ [esimaccess_api_notes.md](./esimaccess_api_notes.md) — eSIMAccess API

**品質・計画**
- [test_coverage.md](./test_coverage.md) — テスト棚卸し（rules36/functions80/client34）
- [seo_plan.md](./seo_plan.md) — SEO/GEO（中国本土は§8.0で対象外）
- [roadmap_v2.md](./roadmap_v2.md) — **残タスク台帳（v0.9→v1.0）**
- [system_fault_patterns_ja.md](./system_fault_patterns_ja.md) — 障害/返金パターン定義
