# 設計書：S10 プロバイダ死活/認証監視 ＋ S9 アラート到達性

対象ブランチ: `dev` ／ 作成: 2026-07-07 ／ ステータス: **設計（要承認→実装）**
関連: [plan_v0.51.md](./plan_v0.51.md) §4（S9/S10）・§1.5 注記の 2026-07 実インシデント

## 背景・目的
2026-07 の実インシデント：`OMAX_CLIENT_ID` 末尾改行 → Bappy認証 401（invalid_client）→ **発行/topup/同期が約4日ダウン**。しかも **気づいたのは顧客申告**で、失敗時の `notifyOwner` も**オーナーに届かなかった**。
→ 本設計で2点を同時に解消：
- **S10**：発行系（プロバイダ認証）が止まったら**数分〜十数分で自動検知し通知**。
- **S9**：アラートが**確実にオーナーに届く**（メール到達を保証）。

この2つは一体（死活監視は「通知が届く」前提で初めて意味を持つ）なので、まとめて実装する。

## 現状（実コードで確認）
- `notifyOwner`（`functions/src/adapters/notify.ts`）：`NOTIFY_PROVIDER`（既定 `"forge"`）で**単一チャンネルのみ**。forge/slack のどちらか1つを呼び、**フォールバック無し**。
  - 🔴 **`ENV.ownerEmail`（`OWNER_EMAIL`）は `env.ts` に定義済みだが、どこからも使われていない** ＝ オーナーのメールには元々1通も飛ばない。**7月に通知が届かなかった根本原因**。
- Bappy認証：`getAccessToken()`（`functions/src/bappy/auth.ts`）が Keycloak（`id.omaxtelecom.com`）からトークン取得。401 で発行/同期が全滅。`isBappyConfigured()` で mock 判定。
- 既存スケジュール：`esimRetryJob`（5分）・`hungOrderMonitor`（15分）。`onSchedule` ＋ secrets のパターン確立済み（`functions/src/scheduled.ts`）。
- `sendEmail({to,subject,html})`（`mailer.ts`）でオーナー宛メール送信可。
- `system_config/{docId}` は既に **isAdmin 限定ルール**（返金のキルスイッチで追加済み）＝新規rules不要。

## 変更方針

### A. S9：`notifyOwner` にメール到達を追加（到達保証）
`functions/src/adapters/notify.ts`
- 挙動を「**プライマリ（forge/slack）を試し、失敗したら OWNER_EMAIL にメール**」へ。さらに `opts.critical === true`（新設・任意）の場合は**プライマリ成否に関わらずメールも送る**（＝重大アラートは必ずメール）。
- `notifyViaEmail(opts)` を追加：`ENV.ownerEmail` があれば `sendEmail` で送信（件名=title、本文=content）。
- 戻り値：いずれか1経路でも成功なら true。全滅は `logger.error`。
- メール送信には Gmail 系 secret が要るため、`notifyOwner` を呼ぶ関数の `secrets` に `GMAIL_USER/GMAIL_PASS`（多くは既にバインド済み）と、必要なら `OWNER_EMAIL` を追加。

### B. S10：`providerHealthCheck`（新規 `onSchedule`・15分）
`functions/src/scheduled.ts`
- `every 15 minutes`、region `asia-northeast1`、secrets: `OMAX_CLIENT_ID/OMAX_CLIENT_SECRET/GMAIL_USER/GMAIL_PASS/BUILT_IN_FORGE_API_KEY/SLACK_WEBHOOK_URL/OWNER_EMAIL`。
- 処理：
  1. `isBappyConfigured()` が false ならスキップ（mock/未設定）。
  2. `getAccessToken()` を実行＝**認証ping**。成功＝healthy／例外・401＝down。
  3. 状態を Firestore `system_config/provider_health` に記録：
     ```
     { bappy: { status:"ok"|"down", lastOkAt, lastDownAt, lastAlertAt, consecutiveFails } }
     ```
  4. **デバウンス通知（スパム防止）**：
     - **healthy→down 遷移**：即 `notifyOwner({critical:true})`（メール必達）。
     - **down 継続**：`lastAlertAt` を見て**1時間に1回だけ**再通知。
     - **down→healthy 復旧**：復旧通知1回。
  5. （将来）eSIMAccess 導入後は同関数に2社目の ping を追加（今回は Bappy のみ・構造だけ拡張余地）。

### C. rules
- `system_config/provider_health` は既存 `system_config/{docId}`（isAdmin）配下＝**追加不要**。関数は Admin SDK で読み書き。

## 影響範囲・リスク
- **functions のみ**（`notify.ts` 改修＋`scheduled.ts` に1関数）。フロント/rules変更なし。
- **要承認・functions デプロイはユーザー指示**（CLAUDE.md）。
- **前提確認**：`OWNER_EMAIL` の Secret/param が本番に設定されているか要確認（未設定ならオーナーメールが送れない）。想定値＝運用者メール。
- 認証ping は軽量（トークン1回取得）。デバウンスで誤検知・多重通知を防止。
- リスク小。ロールバックは関数削除＋notify.ts revert。

## テスト／検証計画
- functions ビルド＋テスト（`npm run build` / `npm test`）。
- 単体：`getAccessToken` を成功/失敗モック → `providerHealthCheck` が healthy/down 判定・`system_config/provider_health` 更新・遷移時のみ `notifyOwner` 呼び出しをテスト。
- 単体：`notifyOwner` のメールフォールバック（プライマリ失敗→`sendEmail` 呼ばれる／critical→常にメール）。
- 手動（慎重に・可能ならStaging相当）：一時的に認証を失敗させ down 検知＋**オーナーメール到達**を確認。
- `dev` コミット → 本番 functions デプロイはユーザー指示。

## S1（可観測性）＝次段（本設計外）
- Error Reporting「新規エラー通知ON」＝**GCPコンソール設定**（コード不要・ユーザー操作）。
- フロントのブラウザ内エラー収集（`window.onerror`/`unhandledrejection`→送信・PIIスクラブ・CSP更新）＝**別設計**で対応。

## 実装フェーズ（この順）
1. **S9**：`notifyOwner` にメール到達＋`critical` 追加（土台）。
2. **S10**：`providerHealthCheck` 実装（S9のメール必達に乗せる）。
3. 検証 → dev コミット →（ユーザー指示で）本番 functions デプロイ。
