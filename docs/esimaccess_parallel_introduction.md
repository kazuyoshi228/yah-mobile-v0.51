# eSIMAccess 並走導入レポート & To-Do（yah.mobile）

作成日: 2026-07-06 ／ 更新: 2026-07-06（公式ドキュメント通読を反映）／ ステータス: **提案（要承認）**
関連: [esimaccess_api_notes.md](./esimaccess_api_notes.md) / [firestore_schema.md](./firestore_schema.md) / [api_functions.md](./api_functions.md) / [screen_flow.md](./screen_flow.md)

> 🚨 本ドキュメントは**戦略・計画レイヤ**。CLAUDE.md の実装フローに従い、各フェーズの着手前に対象コード確認のうえ設計を提示・承認を得てから実装する。とくに `functions/` と `firestore.rules` の変更はユーザー承認が必須。
> 確定した API 実仕様（エンドポイント・フィールド）は [esimaccess_api_notes.md](./esimaccess_api_notes.md) に分離。

---

## 1. 背景・目的

現行の eSIM 供給は **Bappy（OMAX Telecom / BICS Tier-1 backbone）単独**。運用で以下が詰まっている：

- **返金・キャンセル API が無い** → 堅牢化⑥（Stripe 自動返金）を保留中。
- **状態可視化が弱い**（`eSimProfileStatus` を Bappy が露出しない）→ 「発行済み/未インストール/有効化」の判定が推測ベース。
- **再インストールが不透明**（既定3回だが PRP 依存）→ 「再接続できない」系トラブル（例: Order #HouAsnif…）の一次切り分けが困難。

**目的**: eSIMAccess を**2社目として並走導入**し、上記3点（返金/状態取得/再インストール）を API で解決できる導線を用意する。**Bappy は撤去しない**（日本回線品質が未実測の一社に一本化しない）。実測後に供給比率を決める。

### ゴール（Definition of Done）
- 新規購入を **plan 単位で供給元を切替可能**にする（provider 抽象）。
- eSIMAccess 経由での「発行 → QR表示 → 状態同期 → トップアップ → キャンセル/返金」が一通り動く。
- 既存 Bappy フローは無改変で継続（回帰なし）。
- 日本回線品質の実測データを取得し、比率決定の判断材料にする。

---

## 2. 現状の連携構造（実コード）

Bappy 連携は `functions/src/bappy/` に集約済みで、抽象化の起点が明確：

| モジュール API | ファイル | 役割 |
|---|---|---|
| `createLink({ bappyPlanId, orderId })` | bappy/links.ts:52 | eSIM 発行（初回） |
| `getLinkDetail(identifier)` | bappy/links.ts:92 | 状態・使用量取得（同期） |
| `getTopupPlans` / `addTopupPlan` | bappy/topup.ts | トップアップ |
| `isBappyConfigured` / `mapBappyStatus` | bappy/auth.ts, client.ts | 設定判定・ステータス写像 |

**呼び出し側（＝抽象化を差し込む3系統）**
1. **発行**: `webhooks.ts` の `fulfillEsim()`（Stripe 決済完了 → `createLink`/`addTopupPlan`）。
2. **リトライ**: `esimRetryService.ts`（`esim_retry_jobs` 処理 → `createLink`/`addTopupPlan`）。
3. **同期**: `triggers.ts` の `onEsimSyncRequested`（`getLinkDetail` で使用量更新）。
4. **受信**: `webhooks_bappy.ts`（Bappy からの状態 Webhook。認証は OMAX 側）。

データモデル（`shared/types.ts`）は Bappy 前提のフィールドを持つ：
`plans.bappyPlanId` / `orders.bappyPlanId` / `esim_links.bappyLinkUuid` / `esim_activations.bappyActivationUuid`。

---

## 3. eSIMAccess で解決できる改善（公式ドキュメント通読で確認）

API 実仕様の出典・全フィールドは [esimaccess_api_notes.md](./esimaccess_api_notes.md)。各改善は現状の弱点にマッピング：

| # | 改善 | 使う eSIMAccess 機能 | 現状の弱点 | 優先 |
|---|---|---|---|---|
| ① | **ステータスを推測→権威データ化** | 照会 `esimStatus`/`smdpStatus`、Webhook `ORDER_STATUS`/`ESIM_STATUS` | `esimStatus.ts` が `lastActiveAt`・データ消費で有効化を推測 | 最優先 |
| ② | **発行/装着をポーリング廃止・プッシュ化** | Webhook `ORDER_STATUS(GOT_RESOURCE)`/`ESIM_STATUS(IN_USE)` | OrderDetailPage の `setInterval` ＋手動 Sync、都度 `getLinkDetail` | 高 |
| ③ | **しきい値通知の自動化** | Webhook `DATA_USAGE(残≤100MB)`/`VALIDITY_USAGE(残1日)` | `data_threshold_80/100` 定義済だがプッシュ弱い | 高 |
| ④ | **自動返金（堅牢化⑥再開）** | `cancel`＋未使用返金（残高へ） | Bappy に返金 API 無し | 高 |
| ⑤ | **再インストールのリカバリ UX** | 削除済み再インストール可＋Apple Universal Link/EID Push | Bappy 再DL制限が不透明 | 中 |
| ⑥ | **前払い残高モニタ（新規リスク対策）** | `POST /balance/query`＋低残高メール | プリペイド方式は残高不足で発行失敗が起こり得る | 中 |
| ⑦ | **インストール導線の多様化** | `ac`(LPA)→クライアントQR生成、Universal Link 1タップ | QR＋activation URL のみ | 中 |

> ①②③⑦は「今の推測ベースのステータス/ポーリング」を根本改善する。④は保留中の堅牢化⑥を前進させる。

---

## 4. 並走アーキテクチャ方針

### 4.1 Provider 抽象インターフェース（新規 `functions/src/providers/`）
共通 IF を定義し、Bappy 既存モジュールをラップ、eSIMAccess を追加実装する。

```ts
// functions/src/providers/types.ts（案）
export type ProviderId = "bappy" | "esimaccess";

export interface EsimProvider {
  id: ProviderId;
  isConfigured(): boolean;
  createEsim(p: { providerPlanId: string; orderId: string }): Promise<ProviderLink>;
  getEsimDetail(identifier: string): Promise<ProviderLink>;
  getTopupPlans(identifier: string): Promise<ProviderPlan[]>;
  addTopup(p: { identifier: string; providerPlanId: string }): Promise<ProviderActivation>;
  // eSIMAccess のみ実装（Bappy は未対応で throw / no-op）
  cancel?(p: { iccid: string }): Promise<{ refunded: boolean }>;
}

export function getProvider(id: ProviderId | undefined): EsimProvider; // 既定 "bappy"
```

- `providers/bappy.ts`: 既存 `functions/src/bappy/*` をそのまま呼ぶ薄いラッパ（挙動不変）。
- `providers/esimaccess.ts`: eSIMAccess REST（`esim/list`, `esim/topup`, cancel, `balance/query` 等）を実装。
- 呼び出し3系統は `getProvider(order.provider).createEsim(...)` の形に置換。

### 4.2 データモデル変更（追加のみ・後方互換）
| コレクション | 追加フィールド | 備考 |
|---|---|---|
| `plans` | `provider: "bappy"\|"esimaccess"`（既定 bappy）, `providerPlanId` | どの供給元で発行するか。既存は bappy 扱い |
| `orders` | `provider`, `providerPlanId` | 発行時に plan からコピー |
| `esim_links` | `provider`, `providerLinkId`, `providerIccid` | `bappy*` は温存し併記 |
| `esim_activations` | `provider`, `providerActivationId` | 同上 |

> 既存 `bappy*` フィールドは削除しない（移行リスク回避）。新規は汎用 `provider*` に寄せ、`bappy*` は当面ミラーリング。

### 4.3 Webhook / 認証 ★通読で更新
**認証は方向で分けて考える：**

- **送信（yah.mobile → eSIMAccess API）＝ 堅牢・確認済み**
  - ヘッダ `RT-AccessCode`（Developer Console 発行の `accessCode`）＋ **HMAC-SHA256 署名**（公式 Agent Skill が自動処理と明記）。
- **受信（eSIMAccess → yah.mobile Webhook）＝ 署名の記載なし・要確認**
  - Webhook は**コンソールで通知URLを登録するだけ**。受信callbackの署名/検証ヘッダの記載が公式ドキュメントに見当たらない。
  - **⚠️ Bappy とはモデルが違う**：Bappy Webhook 認証は OMAX 側が担当（こちらは実装しない）。eSIMAccess は **URL をこちらが登録＝受信検証は yah.mobile の責任**。「向こうが守ってくれる」前提を置かない。

**受信の多層防御（署名の有無に関わらず安全にする設計・必須）**
1. Webhook URL のパスに**推測不能な秘密トークン**を埋める（値は Secret Manager 管理）。
2. eSIMAccess が**送信元IPを公開していれば IP 許可リスト**。
3. **Webhook は「トリガー」に留め、行動前に必ず認証済み `POST /esim/list` で状態を再確認**してから Firestore 更新／返金を実行（偽通知が来ても実害ゼロ）。送信認証が HMAC で固い分、この「照会で裏取り」が有効。
4. 失敗時は `notifyOwner`（堅牢化⑤と同型）。

新設エンドポイント：`esimaccessWebhook`（onRequest）。資格情報・トークンは **Secret Manager（`defineSecret`）**。コード/ドキュメントに値を書かない。

### 4.4 フロント
- 供給元はユーザーに見せない（内部属性）。QR は既存 `EsimQr.tsx`（`ac`/LPA からクライアント生成）を流用可能。
- マイページの状態判定（`esimStatus.ts`）に eSIMAccess の `esimStatus`/`smdpStatus` を写像する分岐を追加。
- インストール導線に Apple Universal Link（メール/1タップ）を追加検討。

### 4.5 実装支援ツール ★通読で追加
- 公式 **AI Agent Skill**（`npx skills add esimaccess/esimaccess-api`）。MCP でも OpenAPI でもなく“スキル定義”で、17操作（残高・パッケージ一覧・状態照会・発行・topup・cancel/suspend/revoke・SMS・webhook設定）を自然言語で扱える。**Phase 1〜2 の実装加速ツールとして導入検討**。

---

## 5. 未確定事項 / 要確認（着手前に潰す）

- [ ] **日本回線品質**：eSIMAccess は自らを Layer 2（アグリゲーター）と位置づけ＝Bappy/OMAX 同様「集約層」で直接キャリアではない。日本の実網は**パッケージ依存で公開情報から特定不可**。実機テストで実測する（最重要・比率決定の根拠）。
- [ ] **Webhook 署名の有無**：受信callbackに署名（HMAC 等）があるか、検証方法を eSIMAccess に直接確認。無い前提でも §4.3 の多層防御で安全化する。
- [ ] **cancel/返金の前提**：未有効化のみ可か、返金がトップアップまで連鎖するか、返金先（残高）と Stripe 返金の整合。
- [ ] **MOQ / 初期費用 / 決済条件**：前払い残高方式の運用（最小入金・低残高しきい値）。
- [ ] **業務ルール差**：トップアップ最大10回・非リロード可プラン（`supportTopUpType`）・Active/New 時のみ等を plan 設計に反映。

---

## 6. To-Do リスト（フェーズ別）

### Phase 0 — 調査・契約（コード変更なし）
- [x] eSIMAccess 公式ドキュメント通読 → [esimaccess_api_notes.md](./esimaccess_api_notes.md) に確定仕様を記録
- [ ] サンドボックス/テストアカウント発行、資格情報（`accessCode`）の受領（Secret Manager 登録は Phase 2）
- [ ] **Webhook 署名の有無**を eSIMAccess に確認、送信元IP公開の有無も確認
- [ ] 最小ロットで**日本パッケージの実機テスト**（掴む網/速度/再インストール/未有効化キャンセル）→ 結果を本レポートに追記
- [ ] OMAX 問い合わせ送信（Bappy 側の再発行・状態開示の可否確定）
- [ ] Phase 0 結果を踏まえ「並走比率・移行範囲」の方針を決定

### Phase 1 — Provider 抽象（Bappy 挙動不変のリファクタ）※要設計承認
- [ ] `functions/src/providers/types.ts`（`EsimProvider` IF・`getProvider`）
- [ ] `functions/src/providers/bappy.ts`（既存 `bappy/*` の薄いラッパ）
- [ ] `webhooks.ts fulfillEsim` / `esimRetryService.ts` / `triggers.ts onEsimSyncRequested` を `getProvider("bappy")` 経由に置換
- [ ] 既存テスト（`webhooks_bappy.test.ts` 他）が全通過することを確認（**挙動不変の担保**）
- [ ] （任意）Agent Skill を開発環境に導入し実装を加速

### Phase 2 — eSIMAccess 実装 ※要設計承認（functions/secrets/rules）
- [ ] Secret Manager に `accessCode` と **Webhook 秘密トークン**を登録（`defineSecret`）
- [ ] `functions/src/providers/esimaccess.ts`（createEsim/getEsimDetail/topup/cancel/balanceQuery、HMAC-SHA256 署名）
- [ ] データモデル追加（`provider` / `providerPlanId` / `providerLinkId` 等・後方互換）
- [ ] `esimaccessWebhook`（onRequest）新設 → **§4.3 多層防御**（秘密トークン＋`/esim/list` 裏取り）→ 失敗時 `notifyOwner`
- [ ] `firestore.rules`：新フィールドのバリデーション追加（admin plans write の許可リストへ）※**要承認**
- [ ] 管理画面 PlansTab に `provider` 選択を追加

### Phase 3 — フロント適合 & 返金導線
- [ ] `esimStatus.ts` に eSIMAccess の `esimStatus`/`smdpStatus` 写像を追加（①：推測→権威データ）
- [ ] Webhook 駆動でステータス更新（②：ポーリング/手動Sync 廃止）
- [ ] `DATA_USAGE`/`VALIDITY_USAGE` を通知パイプラインへ（③：しきい値自動通知）
- [ ] QR/Universal Link のインストール導線（⑦）
- [ ] 堅牢化⑥の再開：cancel/返金 API による自動返金フロー（④・eSIMAccess plan 限定で先行）
- [ ] `balance/query` 定期監視（⑥・`hungOrderMonitor` と同型）

### Phase 4 — 検証・段階リリース
- [ ] エミュレータ + Rules テスト（新フィールド）／functions build & test／client typecheck & test
- [ ] dev チャンネルで eSIMAccess plan を1件だけ有効化しエンドツーエンド確認（発行→QR→同期→topup→cancel）
- [ ] **カナリア**：eSIMAccess plan を少数のみ `isActive:true` にして実購入で観測
- [ ] 品質・返金が問題なければ供給比率を拡大（新規購入の優先度調整・返金導線から移行）

---

## 7. リスク & ロールバック

- **供給元障害の分離**: provider ごとに独立。片方が落ちても他方の plan は継続。
- **ロールバック**: eSIMAccess plan を `isActive:false` にするだけで新規発行が止まる（既存発行済みは各社の状態取得で継続対応）。Phase 1 は挙動不変なので単独でも安全。
- **Webhook なりすまし**: §4.3 の多層防御（秘密トークン＋`/esim/list` 裏取り）で、署名が無くても偽通知の実害を封じる。
- **データ二重管理**: `bappy*` と `provider*` の併記による混乱 → 新規コードは `provider*` を正とし、`bappy*` は読み取り互換のミラーに限定。
- **返金二重計上**: eSIMAccess cancel と Stripe refund の順序・冪等を設計（`stripe_events` と同様の冪等ガード）。

---

## 8. 結論

機能面（返金/状態取得/再インストール/プッシュ通知）は **eSIMAccess が優位**。送信APIの認証は HMAC-SHA256 で堅牢。ただし
**(a) 日本回線品質は要実測、(b) 受信Webhookの署名は未確認（＝こちらで多層防御が必須）** の2点が残る。よって
**「Provider 抽象で並走 → 日本品質を実測・Webhook署名を確認 → 返金が絡む導線から段階移行」** を推奨する。
まず **Phase 0（実機テスト・署名確認・OMAX問い合わせ）** を実施し、その結果で Phase 1 以降の設計を確定する。
