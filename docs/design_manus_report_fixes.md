# 実装設計図：Manus総合評価レポート指摘の対応（useAuth一本化を除く5件）

対象ブランチ: `dev` ／ 作成: 2026-07-06 ／ 承認: ユーザー「useAuth.ts 12行削除以外、進めて」

## 背景
Manus 総合評価レポート（2026-07-06）の指摘を実コードで検証し、事実確認済みの5件に対応する。
**デプロイ（hosting/functions）は本設計外。実装は `dev` に積み、反映は別途ユーザー明示指示。**

## 対応項目と方針

### ① ファネル3イベント発火（フロントのみ・最優先）
管理画面 `AnalyticsTab.tsx` が集計するが UI 側で未発火の3イベントを追加。`trackEvent(name, props?)`（`client/src/lib/analytics.ts:96`、Cookie同意連動）を使用。
- `plan_tab_click`: `client/src/components/app/PlansSection.tsx:52` `handleDaySelect(d)` 内 → `trackEvent("plan_tab_click", { days: d })`。要 import。
- `checkout_start`: `client/src/components/app/purchase-drawer/usePurchaseCheckout.ts` `handlePurchase()` のバリデーション通過後（`setIsPurchasing(true)` 付近）→ `trackEvent("checkout_start", { bappyPlanId, gb, priceJpy })`。要 import。
- `order_complete`: `client/src/pages/AppPage.tsx:198` `paymentParam === "complete"` 分岐内 → `trackEvent("order_complete", { orderId })`（trackEvent は import 済み）。

### ② テスト追加 A/B/C（functions テストのみ・コード変更なし）
- A（高）: `esimRetryService.test.ts` に「3回失敗→オーナー通知／ユーザー失敗メール」「回復成功→成功メール」。
- B（中）: `webhooks_bappy.test.ts` に「処理失敗時に notifyOwner が呼ばれる」検証。
- C（中）: `firestore.rules.test.ts` に orders への他ユーザー書き込み禁止（IDOR）ケース補強。
- ※既存の実装関数のシグネチャに合わせる（テスト先行でなく現状動作の担保）。既存テストを壊さない。

### ③ zh-TW 翻訳補完（フロントのみ）
`client/src/i18n/zh-TW.ts`（現177行）を `en.ts`（360行）に構造を合わせ、欠落キーを繁体字で補完。en をベースに不足分を翻訳追加。キー構造・ネストは en と一致させる。

### ④ セキュリティヘッダ3件（firebase.json・hostingデプロイで反映）
`firebase.json` の hosting `headers`（`source: "**"`）に追加：
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`（CSP frame-ancestors と重複可だが後方互換で明示）
※設定変更のみ。反映は hosting デプロイ時。

### ⑤ 購入確認メール（functions・要デプロイ承認）
`checkout.session.completed` 受信直後（`webhooks.ts:101` 付近、eSIM発行前）に「ご注文を受け付けました」メールを送信。
- `mailer.ts` に `buildPurchaseReceivedEmail({ orderId })` を追加（`buildEsimReadyEmail` と同型）。
- `webhooks.ts` の session.completed ハンドラで、order 確定後に `sendEmail(...)`（失敗は catch してログ、本処理は継続）。
- eSIM発行完了時の `buildEsimReadyEmail` は従来どおり（＝2通体制：受付→準備完了）。
- **functions 変更のためデプロイは別途承認。実装は dev に積むのみ。**

## 検証計画
- フロント: `npx tsc --noEmit`、`npx vitest run --config vitest.client.config.ts`。
- functions: `cd functions && npm run build && npm test`。
- Rules: エミュレータで `vitest.rules.config.ts`。
- 各項目ごとに検証 → `dev` コミット（種別プレフィックス）。

## 非対象
- `useAuth.ts` のユーザーdoc二重作成一本化（ユーザー指示で除外）。
- 本番/hosting/functions デプロイ（別途明示指示）。
