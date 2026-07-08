# 設計書：大規模リファクタリング v0.6（挙動不変・段階実施）

作成: 2026-07-08 ／ 対象ブランチ: `dev` ／ ステータス: **設計（要承認→実装）**
前提: **eSIMAccess 本番切替直後**（2026-07-08稼働開始）。したがって本計画は「**挙動不変（behavior-preserving）**」を絶対条件とし、各フェーズを独立に検証・コミットできる構成にする。

---

## 0. 背景・目的

v0.4→v0.51→柱2（eSIMAccess）まで機能追加を最優先で積み上げた結果、次の負債が蓄積している（3系統の全域精査に基づく。数値は実測）：

| 領域 | 主な負債 |
|---|---|
| functions | `db.ts` **693行/71関数**（全ドメイン混在・**未テスト**）／`callables.ts` **634行**（7ドメイン混在）／`defineSecret` が**同一シークレットを最大6ファイルで重複宣言**／一回限りの移行callable残存 |
| client | `PlansTab.tsx` **856行**／`AppPage.tsx` **744行**／Firestoreクエリ定義が**15ファイルで重複**／価格・日付フォーマットの分散実装／admin系のインラインstyle多用（PlansTab 54件等） |
| リポジトリ | 役目を終えた**移行スクリプト7本**・**旧ドキュメント11本**が現役と混在／未使用依存4つ／`.playwright-mcp/` gitignore漏れ／CIの pnpm フラグ不整合・hosting workflow 2本重複 |

**目的**：①変更容易性（1ファイル=1責務に近づける）②安全性（未テスト中核 `db.ts` にテスト土台）③発見容易性（現役/アーカイブの分離）。**機能追加・挙動変更は一切しない**（唯一の例外：ユーザー明示指示による admin 2タブの削除＝P1-3）。

## 0.1 絶対条件（ガードレール）

1. 🚨 **Firestoreの永続フィールド名は変更しない**：`bappyPlanId`／`bappyLinkUuid`／`bappyActivationUuid` 等は本番データに永続化済み（FsPlan/FsOrder/FsEsimLink/FsEsimRetryJob）。**型・DB・callable入出力では現名を維持**。整理するのはコード内部のローカル変数・新規コードの命名のみ。
2. 🚨 **Cloud Functions のエクスポート名（=デプロイされる関数名）は不変**。`index.ts` から見た公開面は同一。
3. 🚨 **firestore.rules / storage.rules / functions の外部挙動は不変**（rules は本計画では触らない）。
4. **バレル維持でモック互換**：消費側は従来どおり `./db`・`./callables` を import する（vitest の `vi.mock("./db")` が資産としてそのまま生きる）。分割は「バレルの内側」で行う。
5. 各フェーズ完了ごとに **functions 65 tests / client 27 tests / rules tests / tsc / build 全green** を確認して個別コミット。**本番 functions/hosting デプロイは別途ユーザー指示**（リファクタは挙動不変なので急いでデプロイする必要がない。次回の機能リリースに同乗）。

---

## 1. フェーズ計画（P0→P4、依存順）

### P0. 雑草取り＆リポジトリ衛生（リスク極小・約1h）
実コード変更なし。gitとファイル配置のみ。

- **P0-1** `.gitignore` に `.playwright-mcp/` を追加（現在 git status を汚している）。
- **P0-2** `scripts/archive/` を作成し、役目を終えた7本を `git mv`：
  `migrate-isactive-to-boolean.mjs` / `migrate-openid-to-uid.mjs` / `migrate-esimlink-expirydate.mjs` / `inspect-order-bwov753.mjs` / `fix_mypage.py` / `inject_i18n.py` / `replace_console.py`。`archive/README.md` に「完了済み・再実行禁止」と明記。
  （現役で残す5本：`import-esimaccess-plans.mjs` / `esimaccess-ping.mjs` / `set-admin-role.mjs` / `set-admin-claims.mjs` / `list-firebase-users.mjs`）
- **P0-3** `docs/archive/` を作成し、旧文書11本を `git mv`（`baas_migration_walkthrough.md`、旧 `design_refactoring.md`、`phase2-3-implementation-spec.md`、`proposal_*` 2本、`instructions_for_manus.md`、`instructions_for_chat_agent.md`、`manus_*` 3本、`gmail_setup_guide_ja.md`）。ルートの `FOR_MANUS.md` は削除。**`docs/README.md`（索引：計画/設計/運用/アーカイブ）を新設**。
- **P0-4** 未使用依存の削除：`pnpm remove @hookform/resolvers add tw-animate-css streamdown`（削除前に import 0件を再グレップで確認。`nanoid` は使用確認のうえ判定）。
- **P0-5** CI微修正：`firebase-hosting-*.yml` の `pnpm install` フラグを `ci.yml` と同じ `--no-frozen-lockfile` に統一（※2本の統合は見送り＝挙動が変わるリスク回避。v0.6リポジトリのSecrets前提も現状維持）。

### P1. functions 基盤整理＋adminタブ削減（リスク小・約3h）
- **P1-1 シークレット一元化**：`functions/src/secrets.ts` を新設し、全 `defineSecret` を一箇所で宣言・export。各ファイル（callables/webhooks/webhooks_bappy/webhooks_esimaccess/triggers/scheduled/esimaccess/auth）は import に置換。**SLACK_WEBHOOK_URL×6、FORGE×6、OMAX×5、GMAIL×4… の重複を解消**。`esimaccess/auth.ts` の2つも移設（`isEsimAccessConfigured` は残す）。
- **P1-2 死蔵コード削除**：
  - `adminMigrateIsActiveToBoolean`（callables.ts 191-248行・移行完了済み）を削除＋client 側 PlansTab の「🔧 Migrate isActive」ボタンも削除。※次回 functions デプロイ時に本番からも関数が消える（正常）。
  - `db.ts` の単なるエイリアス `getPendingRetryJobs` → `getPendingEsimRetryJobs` に呼び出し統一しエイリアス削除。
  - `FsIncidentLog` の `type`/`incidentType` 二重フィールドは**読み取り互換のため型は残し**、コメントで正規（`type`）を明記（データ変更なし）。
- **P1-3 adminタブ削減（ユーザー指示 2026-07-08）**：`/admin/communication` と `/admin/incident` を削除。
  - client：`CommunicationTab.tsx`（253行・静的な通知フロー設計書表示のみ）と `IncidentTab.tsx`（311行）を削除。`AdminPage.tsx` のタブ定義・`VALID_TABS`・`admin/types.ts` の `AdminTab` 型・`admin/index.ts` から除去。該当URL直打ちは既存のフォールバック（デフォルトタブ）に落ちる。
  - functions：IncidentTab 専用だった callable **`incidentRunRetryNow` を削除**（唯一の呼び出し元が消えるため）。リトライ実行は `esimRetryJob`（5分毎の自動実行）が担っており**機能欠落なし**。障害・リトライの閲覧は Firestore Console＋オーナー通知（S9）で代替。
  - docs：`runbook_solo_ops.md` 等が /admin 障害タブを参照していれば記述を更新。
  - ※これは「挙動不変」の例外（**ユーザー明示指示による機能削除**）。CommunicationTab の設計書的内容は削除前に `docs/notification_flows.md` として退避する。

### P2. `db.ts` 分割 — リポジトリ層の確立（リスク中・約6h／本丸①）
**方式**：`functions/src/db/` ディレクトリに分割し、**既存の `db.ts` はバレル（再エクスポート）として温存**。全消費側の import・全テストの `vi.mock("./db")` は無変更で通る。

```
functions/src/db/
  core.ts        … db インスタンス / collections / docToObj / queryToArr / toMs
  users.ts       … getUserByUid, upsertUser, updateUser, getAllUsers …
  orders.ts      … createOrder, getOrderBy*, updateOrder …
  esimLinks.ts   … createEsimLink, getEsimLinkBy*, updateEsimLink, EsimActivation系
  retryJobs.ts   … createRetryJob, getPendingEsimRetryJobs, updateRetryJob
  incidents.ts   … createIncidentLog, resolveIncident …
  notifications.ts / inquiries.ts / allowedEmails.ts / analytics.ts / infra.ts
functions/src/db.ts  … export * from "./db/…"（既存パス互換のバレル）
```

- 循環依存対策：`core.ts` は他の db/* を import しない。各ドメインは core のみ参照。
- **テスト土台の新設**：分割と同時に、pure な変換関数（`docToObj`/`toMs` 等）＋ 主要リポジトリ2〜3本（orders/esimLinks）へ**最小ユニットテストを追加**（現状 71関数・テスト0の中核に着手点を作る。全関数の網羅はしない）。

### P3. `callables.ts` 分割（リスク小〜中・約4h／本丸②）
**方式**：`functions/src/callables/` に分割し、`callables.ts` をバレル化。**関数のエクスポート名・リージョン・secrets・enforceAppCheck 設定は1文字も変えない**。

```
functions/src/callables/
  orders.ts    … ordersInitCheckout / ordersInitTopupCheckout / orderRetryPayment
  refunds.ts   … adminRefundOrder
  contact.ts   … submitContactInquiry
  analytics.ts … analyticsGetAiInsights
  incidents.ts … incidentRunRetryNow
functions/src/callables.ts … バレル（export * from "./callables/…"）
```

- P1-1 の secrets.ts を利用（ファイル先頭の defineSecret 群が消える）。
- `callables.test.ts` は import 経路が `./callables` のまま通る（vitest は resolved id でモックするため `../db` 参照でも `vi.mock("./db")` が効く）。

### P4. client 整理（リスク小〜中・約6h／本丸③）
- **P4-1 `lib/queries.ts` 新設**：重複している Firestore クエリ定義を集約（例：`activeInitialPlansQuery()`＝`where isActive==true && planType=="initial"`、`latestCurrencyRatesQuery()`、orders/esim_links系）。AppPage / PurchaseDrawer / PlansSection / PlansTab / useMyPageData / TopupPage / OrderDetailPage 等 15ファイルの直書きを置換。**クエリ内容は完全同一**（インデックス影響なし）。
- **P4-2 `lib/format.ts` 新設**：`formatPrice`（useCurrency のロジックを移し useCurrency はそれを利用）／`formatDate`／`formatDateTime` を一元化。分散していた `toLocaleString` 直書きを置換。
- **P4-3 `PlansTab.tsx`（856行）分割**：`admin/plans/PlanFormModal.tsx`・`PlanDeleteDialog.tsx`・`InlineCell.tsx`・`usePlansTable.ts`（toggle/inlineSave/move/margin計算）に抽出。本体は表の骨格のみ（目標 <400行）。
- **P4-4 `AppPage.tsx`（744行）整理**：セクション（Hero/Reviews/Features/HowItWorks/Compatibility/FAQ/Legal 等）を `components/app/sections/` へ抽出。既に lazy 化済みの構造は維持。
- **P4-5 admin インラインstyleの定数化（軽く）**：`admin/types.ts` 既存の `labelStyle`/`bodyStyle` の適用徹底のみ（新デザインシステム導入はしない）。

### P5. PurchaseDrawerContext の分割＋購入フローテスト拡充（リスク中・約3h）
**目的**：単なる分割ではなく「**購入フローのテストを厚くするための土台**」。現状は Step 単体テストに35フィールド全部のモックが必要で、テスト追加の障壁になっている。

**方式**：`purchase-drawer/context.ts`（35フィールド）を用途別の3コンテキストに分割。既存のコメント区分に沿って切るだけで、**状態の持ち主（PurchaseDrawer本体・useCurrency・usePurchaseCheckout）は変えない**。

```
purchase-drawer/
  context.ts            … 後方互換のバレル（re-export）＋ usePurchaseDrawerCtx は段階的廃止
  contexts/
    flow.ts      … PurchaseFlowCtx（step/setStep・drawerDays/Gb・planDays/planOptions/currentOpt/lastPlanOpt・initialPlanId）
    session.ts   … PurchaseSessionCtx（currency系・formatPrice・isAuthenticated/loading/user）
    checkout.ts  … PurchaseCheckoutCtx（同意7項目＋エラー・purchaseError・isPurchasing・handlePurchase・esimLink/esimLoading）
```

- Provider は PurchaseDrawer 本体で3枚ネスト（値の計算箇所は現状のまま）。各 Step は必要なコンテキストだけを購読。
- **テスト拡充（本命）**：分割後の小さいモック面を使い、`Step4Payment`（同意バリデーション・購入ボタン活性/非活性・エラー表示）と `Step2Confirm`（価格表示）に単体テストを新規追加（+4〜6件目標）。
- 検証は通常ゲートに加え、**devプレビューで購入フロー Step0→4 の手動通し**（決済直前まで）＋ dev チャンネルで実挙動確認。

### 総見積り：**約23h**（P0:1h / P1:3h / P2:6h / P3:4h / P4:6h / P5:3h）。フェーズごとに独立コミット・独立検証。途中中断しても各フェーズ完了時点で常に main化可能な状態を保つ。

---

## 2. やらないこと（明示的な見送り・却下）

| 項目 | 理由 |
|---|---|
| `bappyPlanId`/`bappyLinkUuid` 等の**フィールド名リネーム** | 本番Firestoreに永続化済み。移行はGA後の別プロジェクト（やるならデュアルライト＋バックフィルの本格移行設計が必要） |
| webhooks 3ファイルの統合（`webhooks/` 化） | **本番切替直後の決済・発行経路**。責務は現状でも明確（Stripe/Bappy/eSIMAccess）。動かすリスク＞整理益 |
| mailer のテンプレートエンジン化（mjml等） | 依存追加＋出力差分リスク。現状の関数型テンプレートで十分 |
| `shared/types.ts` の多ファイル分割・FsUser の Core/Profile 分割 | 322行は許容範囲。分割は import 経路変更が全域に波及する割に益が薄い |
| admin 画面の i18n 化（未翻訳20+件） | admin はオーナー専用（solo運用）。5言語化の価値なし |
| vitest 3設定ファイルの統合 | 環境（node/jsdom/rules）ごとの分離は意図的で正当 |
| hosting workflow 2本の1本化・E2EのCI常時実行 | デプロイ挙動を変えるリスク。フラグ統一（P0-5）のみに留める |

---

## 3. 影響範囲・リスクと対策

| リスク | 対策 |
|---|---|
| db 分割での循環依存 | `db/core.ts` を葉に固定（他を import しない）。`madge` 等は導入せず tsc + テストで検出 |
| テストのモック破損 | 消費側 import を `./db`・`./callables` バレルに固定（vi.mock互換）。テストが赤くなったら**テストではなく分割方法を直す** |
| callable の設定差分（region/secrets/appcheck） | 分割は**関数定義ブロックの無編集移動**を原則とし、diff で設定行の同一性を目視確認 |
| 未使用依存の誤削除 | 削除前に import を再グレップ、削除後に build+全テスト |
| adminMigrate 関数の本番削除 | 挙動上は不要関数の削除のみ。次回 functions デプロイ時に削除確認プロンプトが出る旨をランブックに追記 |
| クエリ集約での挙動差 | `lib/queries.ts` は既存クエリの**文字通りの移設**。新規条件は追加しない |
| P5：購入フロー（決済経路）の退行 | 状態の持ち主とロジックは不変・Contextの「配り方」だけ変更。旧 `context.ts` をバレルとして残し段階移行。新規Stepテスト＋devプレビュー通し＋devチャンネル実確認を必須ゲートに |

## 4. テスト・検証計画（各フェーズ共通ゲート）

1. `cd functions && npm run build && npm test`（65+ tests。P2で数件追加）
2. `npx tsc --noEmit -p tsconfig.json`（ルート）
3. `npx vitest run --config vitest.client.config.ts`（27 tests）＋ `--config vitest.rules.config.ts`
4. `npm run build`（フロント）
5. P4 のみ：dev サーバのプレビューで 店頭（Plans表示）／PurchaseDrawer 起動／/admin PlansTab（要ログインのため dev チャンネルで目視）を確認
6. フェーズごとに `dev` へコミット（メッセージ：`refactor(P<n>): …`）。**本番デプロイは行わない**（ユーザー指示があった時のみ）

## 5. 実施順序と承認単位

- 承認は本設計書で**一括**、実施は P0→P1→P2→P3→P4→P5 の順（依存：P1-1→P3、P2→P3は独立だがdb先行が安全。P5は最後＝購入経路を触るため他フェーズの安定を確認してから）。
- 各フェーズ完了時に結果（行数削減・テスト数・diff概要）を報告。問題が出たフェーズは単独でrevert可能。

---
*参考データ（精査結果の詳細）は本書に統合済み。旧 `design_refactoring.md`（v0.4時代）は P0-3 でアーカイブへ。*
