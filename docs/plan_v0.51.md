# yah.mobile v0.51 実装計画書

作成: 2026-07-06 ／ 更新: **2026-07-07（返金機能＋`/contact`ページを本番リリース・進捗棚卸し・出典ラベル中立化）** ／ 基準コミット: `f02ccb3`（dev=main=origin/v0.51）／ ステータス: **進行中（各実装フェーズは着手前に個別承認）**
評価: 現行 = **A（約91/100）**・招待制でソフトローンチ可（**返金Must-fix解消で加点**。GA残は柱1/柱2/可観測性）
リリース: v0.5 本番リリース済み。以降の hardening（rules型安全化・DB改善・購入確認メール等）も**本番反映済み**。詳細は §1.5。

> 🚨 本書は v0.51 全体の**計画レイヤ**。CLAUDE.md の実装フローに従い、`functions/`・`firestore.rules`・本番/hosting デプロイは**各フェーズ着手前にユーザー承認**を得る。本書は「何を・なぜ・どの順で」を確定するためのもの。

---

## 0. このバージョンの位置づけ

- **v0.5（現行）**：主要機能・セキュリティ・SEO/i18n は商用水準。招待制（`allowed_emails`）でコントロール付きローンチが可能。
- **v0.51 のテーマ**：**「一般公開（GA）に耐える堅牢性」＝“お金と障害”の砦を固める。**
- そのため v0.51 は次の **2本柱**を実装の中心に据える：
  1. **Webhook の確認**（Bappy 受信認証の結論＋多層防御の確立）
  2. **eSIMAccess を並走プロバイダとして契約を進める**（Provider 抽象で2社目導入）

> この2本柱は、リリース評価で残った Must-fix（**プロバイダSPOF / 手動返金**）と保留（**Bappy Webhook受信認証**）を**まとめて解消**する。eSIMAccess は返金API・状態取得・再インストールを備えるため、SPOF緩和と返金自動化を同時に前進させられる。

### 0.1 Solo運用（一人保守）の前提
本システムは **BaaS-first・ミニマル・ドキュメント整備**により、**一人保守に向いた土台**を持つ（インフラ運用ほぼゼロ／型・テスト・shared schema／デプロイ規律）。一方で **障害対応・返金・サポートが個人に集中**する構造が残る。
→ **v0.51 の2本柱は「機能改善」であると同時に「一人運用を成立させる運用投資」**でもある：
- **柱2（プロバイダ冗長＋自動返金）**：Bappy障害時の深夜対応と手動返金を激減＝**solo運用の最重要スイッチ**。
- **柱1（Webhook確認）＋S1（可観測性）**：「本当に対応が要る時だけ鳴る」アラート体制の確立。
- **支援WSに solo運用向け項目を追加**（S7ランブック／S8依存自動更新／S9アラート最適化。§4）。運用手順そのものは **別ドキュメント `docs/runbook_solo_ops.md`**（恒久・生きた文書）として計画書と分離し、相互リンクで連携する。

---

## 1. 現状サマリ（このセッションの全レポート集約）

### 1.1 v0.5 で完了済み（**本番リリース済み `008063e`**）
> ①〜⑤は **2026-07-06 の総合評価レポート**（→ [design_manus_report_fixes.md](./design_manus_report_fixes.md)）由来の指摘。実コードで検証のうえ対応済み。

| 区分 | 内容 | 反映 |
|---|---|---|
| 評価① ファネル3イベント | plan_tab_click/checkout_start/order_complete 発火 | **本番hosting ✅** |
| 評価③ zh-TW | 繁体字 167キー補完（100%） | **本番hosting ✅** |
| 評価④ セキュリティヘッダ | HSTS/nosniff/X-Frame-Options | **本番hosting ✅**（yah.mobi で検証済） |
| 評価⑤ 購入確認メール | checkout.session.completed で受付メール | **本番functions ✅** |
| 評価② テスト補強 | retry escalation/recovery・bappy notify・orders IDOR | dev ✅（テストのみ・デプロイ対象外） |
| ⑦ useAuthユーザーdoc一本化 | onUserCreated に集約 | **本番hosting ✅** |
| サポート文言 A/B | 人的チーム含意の除去・応答SLA実値化（5言語） | **本番hosting ✅**（→ [design_support_ai_chat_copy.md](./design_support_ai_chat_copy.md)） |
| plans Rules検証 | 型・範囲・IDORバリデーション | **本番firestore:rules ✅** |
| 旧hardening①〜⑤ | hungOrderMonitor・Bappy障害通知・LLM slice 等 | **本番functions ✅** |

### 1.2 リリース評価（採点・Webhook認証は採点外）
| 領域 | グレード |
|---|---|
| アーキテクチャ/BaaS一貫性 | A− |
| セキュリティ | A−（Webhook認証は評価外） |
| 決済 | A（署名検証・冪等・金額検証◎／**返金＝当社エラー自動＋管理画面手動を実装済**） |
| 信頼性・障害復旧 | B+（**返金自動化済**／SPOFは柱2で対応中） |
| 可観測性・運用 | B−（外部エラートラッキング無し） |
| テスト・CI/CD | B（重要パス有／テストゲート未） |
| コード品質・型 | A− |
| アクセシビリティ | B− |
| i18n/SEO | A |
| **総合** | **A（約91/100）**（返金Must-fix解消で +2） |

### 1.3 GAに向けた宿題（v0.51 スコープ）
- ✅ Must-fix：**①返金経路の確立 → 完了・本番リリース済み**（Lane A当社側エラー自動返金＋Lane B管理画面手動＋Stripe真実源＋5言語メール＋キルスイッチ＋Terms例外条項。§1.5）。※eSIMAccess cancel連携の返金は柱2で追加。
- 🚨 Must-fix：**②プロバイダSPOF緩和** → **柱2（eSIMAccess）**で本質解決。
- ⏸ 確認中：**Bappy Webhook 受信認証** → **柱1**で結論を出す。
- 🟡 早期：**可観測性（Error Reporting通知＋フロントエラー収集）**／**テストゲート付きCI**／**a11y**／**PWAキャッシュ**／**lastSignedIn毎ログイン更新**。
- 🟢 任意：管理画面 `any` 削減・E2E拡充。

### 1.4 参照ドキュメント
- [esimaccess_parallel_introduction.md](./esimaccess_parallel_introduction.md)（並走設計）
- [esimaccess_api_notes.md](./esimaccess_api_notes.md)（確定API仕様）
- [design_manus_report_fixes.md](./design_manus_report_fixes.md)（v0.5対応）
- [design_user_doc_consolidation.md](./design_user_doc_consolidation.md)／[design_pwa_refresh_ux.md](./design_pwa_refresh_ux.md)
- [design_db01_consent.md](./design_db01_consent.md)／[design_db04_expirydate.md](./design_db04_expirydate.md)
- [api_functions.md](./api_functions.md) / [firestore_schema.md](./firestore_schema.md) / [screen_flow.md](./screen_flow.md)

### 1.5 本セッションで完了（2026-07-07 時点・棚卸し）
| 区分 | 内容 | 反映 |
|---|---|---|
| **🎯 返金機能（Must-fix①）** | **Lane A**：当社側エラー（発行/topup最終失敗）を自動全額返金。**Lane B**：`/admin` 返金タブ（返金ボタン＋自動返金ON/OFFキルスイッチ）。**Stripe `charge.refunded` webhook を真実源**に3経路を一元化。購入時ページ言語を注文保存し**5言語返金メール**。Terms/llms.txt に**例外条項**。設計→[spec_refund.md](./spec_refund.md) | ✅ **本番 functions/rules/hosting**＋Stripe設定（charge.refunded購読・返金メールOFF） |
| **問い合わせ専用ページ `/contact`** | AIチャット直リンク用の軽量ページ（`Nav`＋`ContactSection`再利用＋`Footer`）。Nav/Footerの「Contact」は `/app#contact` のまま据え置き。設計→[design_contact_page.md](./design_contact_page.md) | ✅ **本番hosting**（`yah.mobi/contact`） |
| **S2 CIテストゲート** | GitHub Actions（tsc/lint/client/functions/rules を push・PR で自動実行、E2Eは任意ジョブ）。本番デプロイは含めない | ✅ dev（`.github/workflows/ci.yml`・v0.51で稼働） |
| **S4 PWAキャッシュ** | `registerType: prompt` ＋ 更新バナー＋定期update()。手動キャッシュ削除不要に | ✅ **本番hosting** |
| **① Refresh体感改善** | "Syncing…" をデータ反映まで継続＋「Last updated」表示 | ✅ **本番hosting** |
| **S6 E2E拡充** | Playwright 非破壊スイート 34件（スモーク/i18n5言語/法務/主要セクション/プラン/操作系） | ✅ dev |
| **DB改善** | incident_logs 管理読取ルール（実バグ修正）＋索引／型統一（DB-01同意・DB-02 SystemStats・DB-05 analytics）／DB-04 expiryDate epoch ms化＋移行完了 | ✅ **本番 rules/indexes/functions** |
| **障害対応（Bappy認証失効）** | `OMAX_CLIENT_ID` 末尾改行→401 を復旧、esim_links 同期のレート制限ルールを型安全化 | ✅ **本番 functions/rules** |
| SSH運用・v0.51主リポジトリ化 | push をトークン不要のSSHに、origin=yah-mobile-v0.51 | ✅ |

> **残る本丸**：柱1（Webhook確認）／柱2（eSIMAccess並走）／S1（可観測性）／**S10（プロバイダ死活監視）**／S7（運用ランブック）。**返金（Must-fix①）は本セッションで完了**（eSIMAccess cancel連携の返金のみ柱2で追加）。DB-03/09/10 は実コード検証の結果**非改善/無意味/読み手なし**で**非対応**と判断（[firestore_schema.md] 参照）。

---

## 2. 柱1：Webhook の確認 【v0.51 中心-1】

### 2.1 現状
| Webhook | 受信認証 |
|---|---|
| `stripeWebhook`（webhooks.ts） | ✅ 署名検証あり（`stripe-signature` + `constructEvent`） |
| `bappyWebhook`（webhooks_bappy.ts） | ❌ **無し**（コードに `// TODO: Verify Bappy signature` が残存） |

`bappyWebhook` は URL と有効な `bappyLinkUuid` を知る第三者が eSIM の状態/使用量を偽装更新しうる（金銭には非直結だが要対応）。

### 2.2 タスク
- [ ] **OMAX/Bappy に受信署名の有無・方式を確認**（英文問い合わせをドラフト済み）。
- [ ] 結果で分岐：
  - **(a) 署名提供あり** → `bappyWebhook` に署名検証を実装（Secret Manager でキー管理）。
  - **(b) 署名なし** → **多層防御**を実装：
    1. Webhook URL パスに**推測不能な秘密トークン**（Secret Manager）。
    2. 送信元IP公開があれば**IP許可リスト**。
    3. **行動前に `getLinkDetail` で状態を裏取り**してから Firestore 更新（偽通知の実害を封じる）。
    4. 失敗時 `notifyOwner`（既存パターン）。
- [ ] **eSIMAccess Webhook も同方針**で設計（[esimaccess_api_notes.md](./esimaccess_api_notes.md) の通り署名記載なし＝多層防御前提）。

### 2.3 受け入れ基準
- `bappyWebhook`・`esimaccessWebhook` とも、**認証されない/裏取りに失敗したリクエストで Firestore を更新しない**こと（テストで担保）。
- 変更は `functions/` のため**要承認＋functionsデプロイはユーザー指示**。

---

## 3. 柱2：eSIMAccess 並走プロバイダ契約 【v0.51 中心-2】

詳細設計は [esimaccess_parallel_introduction.md](./esimaccess_parallel_introduction.md)。ここでは v0.51 の実行計画として要約。

### 3.1 目的
- **SPOF緩和**（Bappy単一依存の解消）＋**返金自動化**（eSIMAccess は cancel/返金API・状態取得・再インストールを備える）を同時に達成。
- 供給元を **plan 単位で切替可能**にし、既存 Bappy フローは無改変で継続。

### 3.2 切替モデル（採用方針）

**結論：「静的（管理画面でプランごとに指定）を土台に、同等プランだけ自動フェイルオーバー」のハイブリッド。** 純・手動でも純・自動でもない。

#### 外せない技術制約（方式選定の前提）
- **トップアップは発行元プロバイダに固定**：eSIMプロファイルは発行元（Bappy or eSIMAccess）の設備上に存在するため、追加データは同じ供給元にしか打てない。→ **注文/eSIMに「実際に発行したプロバイダ」を必ず記録**（`order.provider` / `esim_link.provider`）。方式に依らず必須。
- **2社のSKUは1:1でない**（データ量・料金・カバレッジ・有効日数が異なる）→ 機械が勝手に「同等」を判断できない。

#### 方式比較
| 方式 | 内容 | 長所 | 短所 |
|---|---|---|---|
| A. 静的（プランごとに指定） | `plans.provider` を管理者が設定・注文が継承 | 単純・確定的・コスト明確・並走/比較容易 | 障害時に自動で救えない |
| B. 完全自動フェイルオーバー | primary失敗→secondaryへ自動 | SPOF自動解消 | SKU非1:1のため誤データ量/割高発行の危険・複雑 |
| C. 比率/ルーティング | 割合・条件で振分け | 段階移行・実験 | 最も複雑 |

#### 採用：A（土台）＋ 限定的B（保険）
1. **土台＝静的**：各プランに `provider` を持たせる（全体トグルは粗すぎるため不採用）。一部を Bappy／一部を eSIMAccess、または同等プランを両社で出して**日本品質を比較**。
2. **保険＝限定自動**：プランに任意で `fallbackProvider` ＋ `fallbackProviderPlanId` を持たせ、**発行がリトライ後も失敗（＝primary障害）した場合のみ、管理者が“同等”と明示したSKUへ自動切替**。勝手な自動化ではなく「管理者が認めたペアに限り自動」。実際に成功した供給元を保存。
3. **非常用スイッチ**：障害検知時に管理画面から primary 一括切替、または fallback 未設定プランを**販売停止**（払えないのに課金しないガード）。

#### データモデル・発行ルーティング（イメージ）
```
plans/{id}: {
  provider: "bappy" | "esimaccess",         // 通常の供給元（管理者指定）
  providerPlanId: "...",                     // 供給元SKU
  fallbackProvider?: "esimaccess" | "bappy", // 任意：同等プランがある場合のみ
  fallbackProviderPlanId?: "..."
}

発行（fulfillEsim）:
  provider = order.provider (= plan.provider)
  try  getProvider(provider).createEsim(...)
  ↓ リトライ後も失敗 & plan.fallback あり
  getProvider(plan.fallbackProvider).createEsim(plan.fallbackProviderPlanId)
  → esim_link.provider = 実際に成功した供給元 を必ず保存
     （以後の topup / 状態同期 / 返金は esim_link.provider で振り分け）
```

#### 管理画面UI（最小）
- PlansTab のプラン編集に **`Provider` セレクタ**（bappy / esimaccess）。任意で **`Fallback provider` ＋ `Fallback plan ID`**。
- ダッシュボードに **供給元ヘルス表示＋「販売停止」トグル**（非常用）。

#### フェーズ対応
- **Phase1**：静的A のみ（`plans.provider`）。既存は全部 `bappy` 継続＝挙動不変。
- **Phase2**：eSIMAccess実装。一部プランを eSIMAccess に。**並走・比較開始**。
- **Phase3**：同等プランに `fallback*` を設定して**自動フェイルオーバー（限定B）**有効化＝SPOF自動解消。非常用の販売停止ガード＆ヘルス監視を追加。

> 一言：**「並走＝プランごとに供給元を持たせる（静的・シンプル）」を基本に、「同等と明示したペアだけ自動で切替（保険）」**。最も“ミニマルで堅牢”。

### 3.3 フェーズと To-Do
**Phase 0 — 契約・調査（コード変更なし）**
- [x] 公式ドキュメント通読・確定仕様の記録（[esimaccess_api_notes.md](./esimaccess_api_notes.md)）
- [ ] **契約を進める**：サンドボックス/テストアカウント発行、`accessCode` 受領
- [ ] **日本パッケージの実機テスト**（掴む網・速度・再インストール・未有効化キャンセル）＝比率決定の根拠
- [ ] Webhook 署名の有無・送信元IP を確認（柱1と連動）
- [ ] MOQ / 前払い残高条件 / 返金連鎖の確認

**Phase 1 — Provider 抽象（Bappy 挙動不変・要承認）**
- [ ] `functions/src/providers/types.ts`（`EsimProvider` IF・`getProvider`）
- [ ] `functions/src/providers/bappy.ts`（既存 `bappy/*` の薄いラッパ）
- [ ] `webhooks.ts fulfillEsim`／`esimRetryService.ts`／`triggers.ts onEsimSyncRequested` を `getProvider("bappy")` 経由へ
- [ ] 既存テスト（37件）全通過＝**挙動不変の担保**
- [ ] （任意）公式 Agent Skill（`npx skills add esimaccess/esimaccess-api`）を実装加速に導入

**Phase 2 — eSIMAccess 実装（要承認・functions/secrets/rules）**
- [ ] Secret Manager に `accessCode`＋Webhook秘密トークン登録
- [ ] `functions/src/providers/esimaccess.ts`（createEsim/getEsimDetail/topup/cancel/balanceQuery・HMAC-SHA256署名）
- [ ] データモデル追加（`provider`/`providerPlanId`/`providerLinkId` 等・後方互換）
- [ ] `esimaccessWebhook`（onRequest）＋**柱1の多層防御**
- [ ] `firestore.rules` に新フィールドのバリデーション追加（**要承認**）
- [ ] 管理画面 PlansTab に `provider` 選択

**Phase 3 — フロント適合＋自動返金（Must-fix解消）**
- [ ] `esimStatus.ts` に eSIMAccess の `esimStatus`/`smdpStatus` 写像（推測→権威データ）
- [ ] Webhook 駆動でステータス更新（ポーリング/手動Sync廃止）
- [ ] `DATA_USAGE`/`VALIDITY_USAGE` を通知パイプラインへ
- [x] **自動返金フロー**＝Must-fix「返金」は 2026-07-07 に**汎用実装で完了・本番リリース済**（Stripe真実源・当社エラー自動＋管理画面手動）。→ 残るは **eSIMAccess の cancel API と返金の連鎖**（cancel→Stripe refund の順序/冪等）を eSIMAccess plan に適合させる部分のみ
- [ ] `balance/query` 定期監視（残高不足の発行失敗予防）

**Phase 4 — カナリア→GA判定**
- [ ] emulator/rules・functions・client の全検証
- [ ] dev で eSIMAccess plan を1件だけ有効化しE2E（発行→QR→同期→topup→cancel）
- [ ] カナリア（少数 `isActive:true`）で実購入観測
- [ ] 品質OKなら供給比率拡大＝**SPOF緩和クローズ**

### 3.4 受け入れ基準
- eSIMAccess 経由で「発行→QR→状態同期→topup→cancel/返金」が一通り動作。
- Bappy 既存フロー回帰なし（テスト全通過）。
- 日本回線品質の実測データを取得済み。

---

## 4. 支援ワークストリーム（GA前に並行対応）

| # | 状態 | 項目 | 内容 | 変更範囲 |
|---|---|---|---|---|
| S1 | ⬜ 未 | 可観測性 | **Error Reporting の新規エラー通知ON**（Functionsは自動集約済）＋**フロントのブラウザ内エラー収集**（Sentry無料枠 or 自前送信・PIIスクラブ・CSP更新） | フロント＋設定 |
| S2 | ✅ 完了 | CI テストゲート | GitHub Actions で push/PR に tsc/lint/client/functions/rules を自動実行。E2Eは任意ジョブ。デプロイは含めない | CI（`ci.yml`） |
| S3 | ⬜ 未 | アクセシビリティ | aria/キーボード点検（購入・問い合わせフォーム優先） | フロント |
| S4 | ✅ 完了 | PWA キャッシュ | `registerType: prompt`＋更新バナー＋定期update()。**本番反映済み** | フロント |
| S5 | ⬜ 未 | lastSignedIn | 毎ログインで更新する仕組み（現状ほぼ未更新） | functions or client |
| **S7（solo）** | ⬜ 未 | **運用ランブック** | 障害/返金/手動発行/デプロイ/復旧/バックアップ手順を **別doc `docs/runbook_solo_ops.md`** に整備（バス係数=1対策・恒久文書） | ドキュメント |
| **S8（solo）** | ⬜ 未 | **依存自動更新** | Dependabot/Renovate で npm/pnpm・Firebase SDK の更新PRを自動化 | CI/設定 |
| **S9（solo）** | ⬜ 未 | **アラート最適化** | 「本当に対応が要る時だけ鳴る」よう Error Reporting/Slack 通知の閾値・粒度を調整 | 設定 |
| **S10（最優先）** | ⬜ 未 | **プロバイダ死活/認証監視** | Bappy(OMAX)/eSIMAccess の**認証を定期ping**（例: `onSchedule` 15分）し **401/失敗を即オーナー通知**。発行/同期エラー率もしきい値監視。**「発行系が止まったら数分で気づく」を担保** | functions＋設定 |
| S6（任意） | 🟡 一部 | 型/テスト | E2E（Playwright 34件）は導入済み。管理画面 `any` 削減は残 | フロント |

> **⚠️ 実インシデント（2026-07-06 検知）が S10 の必要性を実証**：`OMAX_CLIENT_ID` 末尾の改行混入（07-03の Secret Manager 移行時の貼り付け事故）で **Bappy認証が 401 になり、発行・トップアップ・同期が 07-02〜07-06 の約4日間ダウン**。しかも**気づいたのは顧客申告から**で、07-03 の発行失敗時の `notifyOwner` も**オーナーに届いていなかった**（＝アラート到達の穴）。→ **S10（認証死活ping）＋S9（アラート到達性）＋柱2（eSIMAccess並走でSPOF緩和）** を最優先で実装すべき、という具体的裏付け。詳細は運用ランブック（S7）にも「プロバイダ認証失効」の手順として記載する。

---

## 5. マイルストーンと順序（依存関係）

| M | 内容 | 主柱 | 承認/デプロイ |
|---|---|---|---|
| **M1** | 柱1 Webhook確認の結論（OMAX問い合わせ）＋ eSIMAccess 契約着手（Phase0：実機テスト） | 柱1・柱2 | 調査中心・コード変更前 |
| **M2** | Provider 抽象（Phase1・挙動不変） | 柱2 | 要承認・functions |
| **M3** | eSIMAccess 実装＋Webhook多層防御（Phase2）＋ S1可観測性・S2 CI | 柱1・柱2・支援 | 要承認・functions/rules/secrets |
| **M4** | フロント適合＋自動返金（Phase3）＋ S3/S4/S5 | 柱2・支援 | 要承認 |
| **M5** | カナリア→**GA判定**（Phase4） | 柱2 | 本番デプロイはユーザー指示 |

> **低コスト先行**：柱1の販売影響が小さい確認・S1のError Reporting通知ONは M1で先に着手可能。

---

## 6. GA（一般公開）ゲート

v0.51 完了＝以下を満たせば GA 可と判定：
- [x] **Must-fix「返金」クローズ**（2026-07-07 完了・本番リリース済）：当社側エラーは自動全額返金（Lane A）＋管理画面の手動返金（Lane B）＋Stripe真実源で全経路一元反映＋5言語返金メール＋キルスイッチ＋Terms例外条項。※eSIMAccess cancel連携は柱2で追加
- [ ] **Must-fix「SPOF」緩和**（eSIMAccess 並走 or 販売停止ガード＋監視＋手動発行手順）
- [ ] **柱1 Webhook 受信認証の結論**（署名検証 or 多層防御を実装）
- [ ] **可観測性 最低限**（Error Reporting通知＋フロントエラー収集＋**S10 プロバイダ死活/認証監視**＝発行系停止を数分で検知。2026-07インシデントで必須と実証）
- [ ] **サポート/チャット整合**（→ [design_support_ai_chat_copy.md](./design_support_ai_chat_copy.md)）：**(a) AIチャット実装・稼働** または **(b) チャット表記のフォーム主導への修正**（"24/7 chat" 暫定化・CTAをフォームへ・`Terms/Privacy/Cookie` 連絡先の有効化）のいずれか。※人的チーム含意の除去(A)・応答SLAの実値化(B)は v0.5 で対応済み
- [ ] **Solo運用の最低限**（S7ランブック `docs/runbook_solo_ops.md` ＋ S9アラート最適化）＝一人でも「鳴ったら手順どおり対応」できる状態。※交代要員なしのため GA前に必須級
- [ ] 全検証（tsc/vitest/rules/build）＋dev確認＋カナリア観測OK

> それまでは**招待制でGO継続**し、実データを取りながら上記を潰す。

---

## 7. リスク・ロールバック

- **プロバイダ切替の混乱**：`bappy*` と `provider*` の併記 → 新規コードは `provider*` を正、`bappy*` は読み取り互換のミラーに限定。
- **返金二重計上**：eSIMAccess cancel と Stripe refund の順序・冪等（`stripe_events` 同様のガード）。
- **Webhook なりすまし**：多層防御（秘密トークン＋`getLinkDetail`裏取り）で署名有無に依らず実害を封じる。
- **ロールバック**：eSIMAccess plan を `isActive:false` にするだけで新規発行停止。Phase1 は挙動不変で単独安全。

---

## 8. 非対象（v0.51 スコープ外）
- Google ログイン同意画面の遷移先ドメイン（`...firebaseapp.com`→`yah.mobi`）変更＝別テーマ・別途設計。
- 大規模な管理画面リファクタ／新規機能追加。
- 本番デプロイ（各フェーズ完了後にユーザー明示指示で実施）。

---

## 9. 次アクション（提案）
1. 本計画書の承認。
2. **M1 着手**：①OMAXへ Webhook 認証確認の問い合わせ送付、②eSIMAccess のサンドボックス契約＋日本実機テスト手配、③（低コスト）Error Reporting 新規エラー通知ON。
3. M1 の結果を本書に追記し、M2（Provider抽象）の実装設計書を作成 → 承認 → 実装。
