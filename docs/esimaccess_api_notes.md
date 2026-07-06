# eSIMAccess API 確定仕様メモ（yah.mobile）

作成日: 2026-07-06 ／ 出典: 公式ドキュメント通読（下部ソース参照）
用途: 並走導入（[esimaccess_parallel_introduction.md](./esimaccess_parallel_introduction.md)）の実装時リファレンス。

> ⚠️ API 本体（docs.esimaccess.com）は JS レンダリングで自動取得不可のため、公式 KB 記事＋検索から確認できた範囲を記録。実装前に **console/公式 API リファレンスで最終確認**すること（とくにリクエスト/レスポンスの完全なスキーマ）。

---

## 共通

- ベースURL: `https://api.esimaccess.com/api/v1/open/`
- 認証: ヘッダ `RT-AccessCode`（Developer Console 発行の `accessCode`）＋ **HMAC-SHA256 署名**（公式 Agent Skill が自動処理と記載）
- 形式: JSON / REST
- 課金: **前払い残高方式**（write 操作は残高消費、read は無料）
- バージョン: v1.1 で単一→**バッチ発行**、オフライン後払い→**オンライン前払い**、`cancel`/`suspend`/`unsuspend`/`revoke` 追加

---

## エンドポイント

### 発行（Order Profiles）
- バッチ発行・オンライン前払い。リクエストに `packageCode` / `price` / `amount` / `transactionId`（自前の取引参照）。レスポンスに `orderNo`。
- 発行後、`ac`（LPA/アクティベーションコード）・`qrCodeUrl` 等は状態照会（下記）で取得。

### 状態・使用量照会 — `POST /esim/list`
- リクエスト: `iccid`、`pager { pageNum, pageSize }`
- レスポンス `esimList[]` の主フィールド:

| フィールド | 説明 |
|---|---|
| `orderNo` | 注文識別子 |
| `iccid` / `imsi` / `eid` | 各種識別子 |
| `ac` | アクティベーションコード（LPA） |
| `qrCodeUrl` | インストール用 QR の URL |
| `smdpStatus` | SM-DP+ 状態（例: `RELEASED`, `INSTALLATION`） |
| `esimStatus` | eSIM 稼働状態（例: `GOT_RESOURCE`, `IN_USE`） |
| `activeType` | 有効化方式 |
| `expiredTime` | 有効期限 |
| `totalVolume` | 総データ量（bytes） |
| `orderUsage` | 消費データ（bytes） |
| `totalDuration` / `durationUnit` | 有効期間／単位（`DAY` 等） |
| `packageList[]` | `packageCode` / `duration` / `volume` / `locationCode` |

- **残量 = `totalVolume − orderUsage`**

### トップアップ — `POST /esim/topup`
- リクエスト: `ICCID` または `esimtranno`、`packageCode`（`TOPUP_` プレフィックス）または Slug、`TransactionID`
- レスポンス: 新しい残り期間・総データ量
- 制約: **最大10回**／`Active`(In Use) または `New` 状態のみ／期限切れ後は不可／非リロード可プランは対象外（`supportTopUpType: 1` で判定）／**有効期間とデータは加算**
- 可用パッケージ確認: パッケージ一覧を `type=TOPUP` ＋ `iccid` で照会

### キャンセル / 返金
- `action=cancel` ＋ `iccid` でキャンセル API を呼ぶ（v1.1 追加）
- **未使用オーダーは残高へ返金**可（`suspend`/`unsuspend`/`revoke` も提供）
- ⚠️ 未有効化のみ可か等の前提は**要最終確認**

### 残高照会 — `POST /balance/query`
- マーチャント残高を取得。低残高時はアカウントメール通知あり。

---

## Webhook（受信通知）

- 設定: コンソール `https://console.esimaccess.com/developer/index` で通知URLを登録
- 形式: JSON（URLクエリ文字列へ変換ツールあり）
- **署名/受信検証の記載は公式ドキュメントに見当たらない → 要確認。** 受信側で多層防御が必要（親レポート §4.3）。

| イベント | 発火条件 | ペイロード主フィールド |
|---|---|---|
| `ORDER_STATUS` | 発行完了（DL可能） | `orderNo`, `transactionId`, `orderStatus`(例 `GOT_RESOURCE`) |
| `ESIM_STATUS` | eSIM 使用開始（端末装着） | `orderNo`, `transactionId`, `iccid`, `esimStatus`(例 `IN_USE`), `smdpStatus`(例 `INSTALLATION`) |
| `DATA_USAGE` | データ残 ≤100MB | `orderNo`, `transactionId`, `iccid`, `totalVolume`, `orderUsage`, `remain` |
| `VALIDITY_USAGE` | 有効期限 残1日 | `orderNo`, `transactionId`, `iccid`, `durationUnit`, `totalDuration`, `expiredTime`, `remain` |

---

## 有効化（インストール）方式

1. QR コードスキャン（`qrCodeUrl` / `ac`）
2. EID プッシュ（EID 指定で端末へ配信）
3. アプリ内プロビジョニング（リンクからQR不要でインストール）
4. **Apple Universal Link**（SMS/メールの URL を1クリック）
5. 手動入力（SM-DP+ アドレス＋アクティベーションコード `ac`）
- 削除済み eSIM の**再インストール可**（原QR/新QRの別は要確認）

---

## 実装支援：公式 AI Agent Skill

- 導入: `npx skills add esimaccess/esimaccess-api`（GitHub から取得しエージェントの skill ディレクトリへ）
- 実体: MCP でも OpenAPI でもなく **“スキル定義”**（Claude Code / Cursor / Copilot 等向け）
- 認証（`accessCode` ＋ HMAC-SHA256 署名）を自動処理
- 17操作: 残高照会・パッケージ一覧・注文/プロファイル状態照会・データ消費照会・Webhook設定確認（read）／発行・topup・cancel/suspend/revoke・SMS送信・Webhook設定（write）

---

## エコシステム上の位置づけ

- eSIMAccess は自らを **Layer 2（アグリゲーター）** と位置づけ（100+エリア・多数SKUを1API化）。**Bappy/OMAX と同じ集約層**で、いずれも直接キャリアではない。
- → **日本の実網はパッケージ依存＝実機テストが必須**（`packageList.locationCode` で地域は分かるが実キャリアは非公開）。

---

## ソース

- Making an eSIM purchase with the API — https://esimaccess.com/making-an-esim-purchase-with-the-api/
- Can I check data usage? — https://esimaccess.com/docs/can-i-check-data-usage/
- How to Top Up a Data Plan? — https://esimaccess.com/docs/how-to-top-up-a-data-plan/
- eSIM Top Up with the API — https://esimaccess.com/esim-top-up-with-the-api/
- What notifications do you send? — https://esimaccess.com/docs/what-webhook-notifications-do-you-send/
- Setting up Webhooks for Order Notifications — https://esimaccess.com/setting-up-webhooks-for-order-notifications/
- What are the eSIM activation methods? — https://esimaccess.com/docs/what-are-the-available-esim-activation-methods/
- eSIM Access API Agent Skill — https://esimaccess.com/esim-access-api-agent-skill/
- How the eSIM ecosystem actually works — https://esimaccess.com/how-the-esim-ecosystem-actually-works-and-why-its-changing-fast/
- API Archives — https://esimaccess.com/docs-category/api/
