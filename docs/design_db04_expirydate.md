# 実装設計書：DB-04 FsEsimLink.expiryDate の型統一（string → number）

対象ブランチ: `dev` ／ 作成: 2026-07-07 ／ ステータス: **提案（要承認・データ移行あり）**
出典: 「yah.mobile DB改善 指示書 v1.0」DB-04 ／ 実コードで検証済み

## 実コード検証の結果（指示書との差異）
- `FsEsimLink.expiryDate: string | null`（ISO文字列）、`FsEsimActivation.expiryDate: number | null`（epoch ms）＝**不一致は事実**。
- **書込元（esim_links）**：Bappy の ISO 文字列をそのまま保存。
  - `webhooks.ts:238`（fulfillEsim）：`expiryDate: link.expiryDate ?? null`（string）
  - `triggers.ts:103`（onEsimSyncRequested）：`expiryDate: detail.expiryDate ?? null`（string）
  - Bappy 側 `bappy/links.ts` / `bappy/types.ts` は `expiryDate: string | null`。
- **読取（client）**：`esimStatus.ts` / `OrderList.tsx` は **`new Date(esim.expiryDate)`** で処理＝**string/number 両対応済み**。型も `Date | string | null`。
- → **指示書の「MyPage 表示バグの根本原因」は誤り**（現状バグは無い）。本件は**整合性・保守性のための統一**。

## 方針
`esim_links.expiryDate` を **`number | null`（epoch ms）** に統一。Bappy の ISO は **書込直前に Cloud Functions で変換**する。

### 変更点
1. **型**：`shared/types.ts` `FsEsimLink.expiryDate: string | null` → `number | null`。
2. **書込変換（Bappy型は据え置き、esim_links書込点で変換）**：
   - `webhooks.ts:238`：`expiryDate: link.expiryDate ? new Date(link.expiryDate).getTime() : null`
   - `triggers.ts:103`：`expiryDate: detail.expiryDate ? new Date(detail.expiryDate).getTime() : null`
   - （`bappy/*` の `BappyLink.expiryDate: string` は topup 等でも使うため**変更しない**＝局所化）
3. **既存データ移行**：`scripts/migrate_esimlink_expirydate.ts`（冪等）
   - `esim_links` 全件走査、`expiryDate` が **string のものだけ** `new Date(str).getTime()` に変換して更新。既に number/null はスキップ。
   - ドライラン（対象件数表示）→ 実行、の2段。対象0なら実行しない（CLAUDE.md）。
4. **client（任意・簡素化）**：`components/mypage/types.ts` の `expiryDate: Date | string | null` → `number | null`。`esimStatus.ts`/`OrderList.tsx` は `new Date(number)` で動くため**ロジック変更不要**。

## 影響範囲
- `shared/types.ts`／`functions/src/webhooks.ts`・`triggers.ts`／`scripts/`（新規移行）／（任意）`client/src/components/mypage/*`。
- `bappy/*`・rules・課金パスは**不変**。
- `FsEsimActivation.expiryDate`（既に number）は変更なし。

## 移行中の互換性
- 変換前後で client は `new Date(x)` により **string/number 混在でも表示継続**＝**無停止移行**。
- 書込点を先に number 化 → 以後の新規/同期は number。既存 string は移行スクリプトで number 化。

## 検証計画
1. **Firestore エミュレータ**で移行スクリプトをテスト（string→number 変換、冪等性、number/null スキップ）。
2. `functions` ビルド＆テスト／`npx tsc --noEmit`／client テスト。
3. dev チャンネルで実 eSIM の期限表示が従来どおり出ることを確認（`bwov753` 等）。
4. 手順：**①コードデプロイ（functions）→ ②移行スクリプト実行（本番・ドライラン→本実行）**。既存 string を残さない。
5. `dev` コミット。本番反映（functions デプロイ・移行実行）は**ユーザー指示で**。

## リスク・ロールバック
- リスク：移行漏れの string が残っても client は表示継続（実害小）。移行は再実行可能（冪等）。
- ロールバック：型を `string | number | null` に緩めれば混在許容。逆変換スクリプトも用意可能。

## 優先度の所見
現状**機能バグは無い**ため緊急ではない。整合性・将来の比較/ソート容易化のための改善。DB-01（無リスク）を先行し、本件は移行を伴うため**エミュレータ検証を挟んで慎重に**進める。
