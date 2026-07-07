# yah.mobile v0.51 実装計画書 ver.2 — 未実装項目のみ

作成: 2026-07-07 ／ 基準コミット: `bfb1fdb`（dev=origin/v0.51）／ ステータス: **進行中（各フェーズ着手前に個別承認）**
前提: 完了済みの経緯は [plan_v0.51.md](./plan_v0.51.md)（ver.1）参照。**本書は「これから作るもの」だけ**に絞る。

> 🚨 CLAUDE.md の実装フロー厳守：`functions/`・`firestore.rules`・本番/hostingデプロイは**各フェーズ着手前にユーザー承認**。

---

## 0. 現在地（要約）

**完了して本番稼働中**（詳細は ver.1 §1.5）：返金機能（Lane A/B・Stripe真実源・5言語メール・キルスイッチ）／`/contact` 専用ページ／**S1 可観測性**（Error Reporting通知＋フロントエラー収集）／**S9 アラート到達性**（notifyOwnerメール必達）／**S10 プロバイダ死活監視**（`providerHealthCheck` 15分ping）／S2 CI／S4 PWA／DB改善。

**現行評価：A（約93/100）**。Must-fix「返金」「可観測性」はクローズ済み。

**GAに残る本丸：柱1（Webhook認証）・柱2（eSIMAccess＝SPOF緩和）・S7（運用ランブック）・サポート/チャット整合。** ＋ 早期の軽量項目（S3/S5/S8）。

---

## 1. 残タスク一覧（優先度・規模つき）

| # | 項目 | 種別 | 優先 | 規模 | GAゲート |
|---|---|---|---|---|---|
| 柱1 | Bappy/eSIMAccess Webhook 受信認証 | functions | ★★★ | 中 | ✅必須 |
| 柱2 | eSIMAccess 並走プロバイダ（SPOF緩和＋eSIMAccess返金連携） | 契約+functions+client | ★★★ | 大 | ✅必須 |
| S7 | 運用ランブック（solo運用） | ドキュメント | ★★★ | 小 | ✅必須 |
| SUP | サポート/チャット整合 | 別PJ or フロント | ★★ | 小〜中 | ✅必須 |
| S3 | アクセシビリティ（a11y） | フロント | ★★ | 中 | 推奨 |
| S5 | lastSignedIn 毎ログイン更新 | functions/client | ★ | 小 | 任意 |
| S8 | 依存自動更新（Dependabot/Renovate） | CI設定 | ★ | 小 | 任意 |
| S6' | 管理画面の `any` 削減 | フロント | ☆ | 中 | 任意 |

---

## 2. 柱1：Webhook 受信認証 【GA必須・中】

### 現状（実コード）
| Webhook | 認証 |
|---|---|
| `stripeWebhook` | ✅ 署名検証あり |
| `bappyWebhook`（`webhooks_bappy.ts`） | ❌ **無し**（`// TODO: Verify Bappy signature` 残存） |

URL＋有効な `bappyLinkUuid` を知る第三者が eSIM 状態/使用量を偽装更新しうる（金銭非直結だが要対応）。

### やること
1. **OMAX/Bappy に受信署名の有無・方式を問い合わせ**（英文ドラフト用意）。
2. 分岐：
   - **(a) 署名あり** → `bappyWebhook` に署名検証実装（Secret Manager でキー管理）。
   - **(b) 署名なし** → **多層防御**：①URLに推測不能な秘密トークン ②送信元IP許可（公開があれば） ③**行動前に `getLinkDetail` で裏取り**してから Firestore 更新 ④失敗は `notifyOwner`（S9でメール必達化済み）。
3. eSIMAccess Webhook も同方針（署名記載なし＝多層防御前提）。

### 受け入れ基準
- 認証/裏取りに失敗したリクエストで Firestore を更新しない（テストで担保）。
- **要承認・functionsデプロイはユーザー指示**。

---

## 3. 柱2：eSIMAccess 並走プロバイダ 【GA必須・大＝最大WS】

詳細設計は [esimaccess_parallel_introduction.md](./esimaccess_parallel_introduction.md) / [esimaccess_api_notes.md](./esimaccess_api_notes.md)。方式は ver.1 §3.2（**静的Aを土台＋同等ペアだけ限定自動フェイルオーバーB**）で確定済み。ここでは残作業のみ。

### 狙い
**SPOF緩和**（Bappy単一依存の解消）＋ **eSIMAccess の cancel/返金API 連携**（返金の当社起点自動化を柱2で完成）。

### フェーズと残To-Do
**Phase 0 — 契約・調査（コード変更なし）**
- [ ] 契約：サンドボックス発行・`accessCode` 受領
- [ ] **日本パッケージ実機テスト**（掴む網/速度/再インストール/未有効化キャンセル）＝供給比率の根拠
- [ ] Webhook 署名有無・送信元IP 確認（柱1と連動）／ MOQ・前払い残高・返金連鎖の確認

**Phase 1 — Provider 抽象（Bappy挙動不変・要承認）**
- [ ] `functions/src/providers/types.ts`（`EsimProvider` IF・`getProvider`）
- [ ] `providers/bappy.ts`（既存 `bappy/*` の薄いラッパ）
- [ ] `fulfillEsim`／`esimRetryService`／`onEsimSyncRequested` を `getProvider("bappy")` 経由へ
- [ ] 既存テスト全通過＝**挙動不変の担保**

**Phase 2 — eSIMAccess 実装（要承認・functions/secrets/rules）**
- [ ] Secret Manager に `accessCode`＋Webhook秘密トークン
- [ ] `providers/esimaccess.ts`（createEsim/getEsimDetail/topup/cancel/balanceQuery・HMAC署名）
- [ ] データモデル追加（`provider`/`providerPlanId`/`providerLinkId`・後方互換）
- [ ] `esimaccessWebhook`（＋柱1の多層防御）／`firestore.rules` に新フィールド検証（要承認）
- [ ] 管理画面 PlansTab に `provider` セレクタ

**Phase 3 — フロント適合＋eSIMAccess返金連携**
- [ ] `esimStatus.ts` に eSIMAccess の状態写像（推測→権威データ）／Webhook駆動でステータス更新
- [ ] **eSIMAccess cancel→Stripe refund の連鎖**（順序・冪等）を既存 `executeRefund` に適合＝Must-fix「返金」の残り
- [ ] `balance/query` 定期監視（残高不足の発行失敗予防）→ S10 `providerHealthCheck` に相乗り

**Phase 4 — カナリア→GA判定**
- [ ] emulator/rules・functions・client 全検証 → dev で eSIMAccess plan 1件 E2E（発行→QR→同期→topup→cancel）
- [ ] カナリア（少数 `isActive:true`）で実購入観測 → 品質OKで供給比率拡大＝**SPOF緩和クローズ**

### 受け入れ基準
- eSIMAccess 経由で「発行→QR→同期→topup→cancel/返金」が通る／Bappy 既存回帰なし／日本回線実測データ取得済み。

---

## 4. S7：運用ランブック（solo運用）【✅初版作成済・随時更新】

- **`docs/runbook_solo_ops.md`（[こちら](./runbook_solo_ops.md)）を作成済み**（恒久・生きた文書）。障害/返金/手動発行/デプロイ/復旧/バックアップ手順を集約（バス係数=1対策）。
- 既存の実装済み機能を手順に落とす：**S10死活アラートが来たときの対応**（OMAX認証確認手順）／**返金の実行**（/admin返金タブ＋キルスイッチ）／**プロバイダ切替**（柱2導入後）。
- 2026-07 インシデント（`OMAX_CLIENT_ID` 改行→4日ダウン）を「プロバイダ認証失効」ケースとして明記。
- コード変更なし。計画書とは分離し相互リンク。

---

## 5. SUP：サポート/チャット整合 【GA必須・小〜中】

現状：`/contact` 専用ページと問い合わせフォームは本番稼働。AIチャット（`yah-chat-webdev`）は別プロジェクトで進行中（別リポジトリ・Error Reportingノイズ対応タスクあり）。

GA前にどちらか：
- **(a) AIチャットを実装・稼働**（別PJ完了を待つ）、または
- **(b) 表記のフォーム主導への修正**（"24/7 chat" 等の暫定化・CTAを `/contact` へ・Terms/Privacy/Cookie 連絡先の有効化）。

→ [design_support_ai_chat_copy.md](./design_support_ai_chat_copy.md) 準拠。**チャット稼働の見通し次第で (a)/(b) を選ぶ**。

---

## 6. 早期・軽量（GA前推奨〜任意）

- **S3 a11y（推奨・中）**：aria/キーボード点検。購入・問い合わせフォーム優先。フロントのみ。
- **S5 lastSignedIn（任意・小）**：毎ログインで更新する仕組み（現状ほぼ未更新）。functions or client。
- **S8 依存自動更新（任意・小）**：Dependabot/Renovate で npm/pnpm・Firebase SDK 更新PRを自動化。CI設定。
- **S6' 管理画面 `any` 削減（任意・中）**：型安全性の底上げ。

---

## 7. 推奨実行順（依存関係）

```
M1  柱1 OMAX問い合わせ送付 ＋ 柱2 Phase0（契約・実機テスト）  … 調査中心・低コスト先行
    ＋ S7 ランブック着手（コード不要・並行可）
        │
M2  柱2 Phase1（Provider抽象・挙動不変）                      … 要承認・functions
        │
M3  柱2 Phase2（eSIMAccess実装＋Webhook多層防御=柱1結論）      … 要承認・functions/rules/secrets
        │
M4  柱2 Phase3（フロント適合＋eSIMAccess返金連携）＋ S3/S5     … 要承認
        │
M5  柱2 Phase4（カナリア→GA判定）＋ SUP整合                    … 本番はユーザー指示
```

**低コスト先行でGAに早く近づく順**：まず **S7ランブック**（すぐ書ける）＋ **柱1のOMAX問い合わせ送付**（返信待ちの間に他を進められる）＋ **柱2 Phase0の契約手配**。この3つは並行かつ低リスクで着手できる。

---

## 8. GA ゲート（残りのみ）

- [ ] **柱1 Webhook 受信認証の結論**（署名検証 or 多層防御を実装）
- [ ] **Must-fix「SPOF」緩和**（eSIMAccess 並走 or 販売停止ガード＋監視＋手動発行手順）
- [ ] **eSIMAccess 返金連携**（cancel→refund・柱2 Phase3。※汎用返金は実装済み）
- [ ] **サポート/チャット整合**（(a)チャット稼働 or (b)フォーム主導への表記修正）
- [x] **S7 運用ランブック**（[runbook_solo_ops.md](./runbook_solo_ops.md) 初版作成済・生きた文書として随時更新）
- [ ] （推奨）S3 a11y

> 既に満たしたゲート：Must-fix返金 ✅／可観測性（Error Reporting＋フロント収集＋S10死活＋S9到達性）✅／CIテストゲート ✅。

---

## 9. 次アクション（提案）
1. 本書の承認。
2. **同時並行で低コスト着手**：① S7 `runbook_solo_ops.md` 起稿、② OMAX へ Webhook 認証確認メール送付、③ eSIMAccess サンドボックス契約＋日本実機テスト手配。
3. 柱2 Phase1（Provider抽象）の実装設計書を作成 → 承認 → 実装。
