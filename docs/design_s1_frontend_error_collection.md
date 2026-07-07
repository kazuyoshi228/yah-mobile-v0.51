# 設計書：S1(b) フロントのブラウザ内エラー収集

対象ブランチ: `dev` ／ 作成: 2026-07-07 ／ ステータス: **設計（要承認→実装）**
関連: [plan_v0.51.md](./plan_v0.51.md) §4 S1 ／ S1(a) Error Reporting 新規エラー通知ON（コンソール設定・コード外）

## 背景・目的
バックエンド（Functions）の例外は Cloud Error Reporting に自動集約されるが、**ブラウザ側の実行時エラー（白画面・購入導線の JS 例外等）は現状どこにも届かない**。→ フロントの `error`/`unhandledrejection` を捕捉し、**PIIを除去して**サーバに送り、**既存の Cloud Error Reporting に統合**する（外部SaaS不要・BaaS-first）。

## 方針（ミニマル・既存パターン流用）
`analyticsEvents`（`functions/src/analytics.ts` の `onRequest`＋CORS＋レート制限＋サイズ制限）と、クライアントの `trackEvent`→`/api/analytics/events`（`client/src/lib/analytics.ts`）を**そのまま雛形**にする。

### 1. サーバ：`clientErrorLog`（新規 onRequest）
`functions/src/clientErrors.ts`（新規）＋ `index.ts` で export。
- `onRequest({ region, cors: ENV.allowedOrigins })`、**POST限定**、`analyticsEvents` と同じ CORS/405/レート制限（`enforceRateLimit`）を流用。
- 受信ペイロードを **zod で検証＋サイズ上限**（stack は ~2KB に切詰め）。
- **`logger.error("[clientError] ...", structured)`** で Cloud Logging に出力 → **Error Reporting が自動集約**（バックエンドと同じ画面に並ぶ）。Firestore には**書かない**（storage/rules を増やさない・ログで十分）。
- 濫用対策：POST限定・CORS・IPレート制限・サイズ制限・（必要なら）App Checkは付けない（エラーは App Check 前にも起きるため）。

### 2. ルーティング：`firebase.json` に rewrite 追加
- `/api/client-errors` → function `clientErrorLog`（`/api/analytics/events` と同形）。
- **同一オリジン**（yah.mobi）POST のため **CSP変更不要**（`connect-src 'self' https://yah.mobi` で充足）。

### 3. クライアント：`client/src/lib/errorReporting.ts`（新規）＋ `main.tsx` で初期化
- `window.addEventListener("error", …)` ＋ `window.addEventListener("unhandledrejection", …)` を設置。
- **PIIスクラブ**：送るのは `message` / `name` / `stack`(切詰) / `location.pathname`（**クエリ・ハッシュは除去**）/ `userAgent` / `viewport` / `ts` / `lang` / `release`（ビルド識別）/ 使い捨て `sessionId`。**送らない**：クエリ文字列（`?orderId=` 等）・メール・cookie・localStorage・フルURL。
- **多重・洪水防止**：同一 message は1回だけ（dedupeセット）、**1セッション最大5件**、送信は `navigator.sendBeacon`（無ければ `fetch(keepalive)`）。
- 収集自体は同意不要（PII非送信の技術ログ）だが、`analytics` と異なり**個人を特定しない**方針を明記。

## 影響範囲・リスク
- 追加：`functions/src/clientErrors.ts`（新規・小）／`firebase.json`（rewrite 1行）／`client/src/lib/errorReporting.ts`（新規）＋`main.tsx`（初期化1行）。
- **rules 変更なし**（Firestore未使用）。**CSP変更なし**（同一オリジン）。
- 要承認・functions/hosting デプロイはユーザー指示。
- リスク小。濫用は CORS＋レート制限＋サイズ制限＋クライアント側キャップで抑制。ロールバックは rewrite とハンドラ除去。

## テスト／検証計画
- functions build/test（`clientErrorLog` の 405/サイズ超過/正常 を単体）。
- client：`errorReporting` の dedupe/キャップ/スクラブ（クエリ除去）を単体。
- プレビュー：意図的に例外を発生させ、`/api/client-errors` に**クエリ抜き**ペイロードが飛ぶ（Networkで確認）／Functionsログに `[clientError]` が出る。
- `dev` コミット →（ユーザー指示で）本番 functions/hosting デプロイ → Error Reporting に反映を確認。

## 実装フェーズ
1. サーバ `clientErrorLog` ＋ rewrite。
2. クライアント `errorReporting.ts` ＋ `main.tsx` 初期化。
3. 検証 → dev コミット → デプロイ（指示で）。
