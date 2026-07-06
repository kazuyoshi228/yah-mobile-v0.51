# 設計図：マイページ 4件（ICCID / 不要ボタン / 通知i18n / eSIMステータス検証）

作成日: 2026-07-06 / 対象ブランチ: `dev`

---

## ④【最優先・バグ確定】eSIMステータス判定の誤り

**症状**：Order `bwov753WYkraxjQxh8Ug` が「Active」表示だが Expire が無い。

**実データ（Firestore 読取）**：`status:"active"`, `lastActiveAt: 無し`, `expiryDate: null`, `data: 1000/1000（未消費）`。

**根本原因**：`functions/src/webhooks.ts` の `fulfillEsim` は **eSIM発行時に `status:"active"` を即セット**する（＝「発行済み」の意味）。端末での**実有効化**は `webhooks_bappy.ts` が `lastActiveAt`（＋データ消費・expiry開始）で表す。
現行 `deriveEsimStatus` は `activated = (status==="active" || lastActiveAt!=null)` としており、**発行済み=即Active**と誤判定 → 未インストールでも "Active"。本来このデータは **"Ready to Install"** が正しい。

**修正**：有効化の判定を「実際に使われた証跡」に変更する。
```ts
// 変更前: const activated = esim.status === "active" || esim.lastActiveAt != null;
// 変更後:
const activated =
  esim.lastActiveAt != null ||
  (esim.dataRemainingMb != null && esim.dataTotalMb != null && esim.dataRemainingMb < esim.dataTotalMb);
```
- `lastActiveAt` があれば有効化済み（主シグナル）。
- 旧データ対策として「データ消費あり（remaining<total）」も有効化とみなす。
- `status==="active"` は発行マーカーなので判定から除外。`expired`（`status==="expired"` or 期限経過）判定は現状維持。
- 対象データ（1000/1000・lastActiveAt無し）→ **Ready to Install** に是正。
- `esimStatus.test.ts` に「status=active でも lastActiveAt無し＆データ未消費 → ready」ケースを追加。

---

## ①【要判断】ICCID の表示

**現状**：3箇所で表示（`Step6Esim`＝発行ドロワー、`ActiveEsimSummary`＝カード、`OrderDetailPage`＝詳細行）。

**見解**：ICCID は eSIM の識別子で、**一般ユーザーの利用（QRスキャン/有効化）には不要**。主にサポート/トラブル対応時の識別用。
**推奨**：**詳細ページ（OrderDetailPage）にのみ残し、カード（ActiveEsimSummary）と発行ドロワー（Step6）からは削除**して情報量を減らす。
→ ご希望なら「全部削除」または「現状維持」も可。**どうするか確認**。

## ②【削除】Contact support / Buy another eSIM ボタン

**現状**：`OrderDetailPage` 下部の共通行（303-315）に「Contact support」＋「Buy another eSIM」。
**対応**：この**下部共通行（303-315）を削除**。
※ 失敗注文ブロック内の "Contact support →"（289-294・返金/失敗時の導線）は**残す**のが妥当（別物）。→ これも消すかは**確認**。

## ③【通知i18n】各言語にそろえる

**現状**：
- 通知**本文**（`n.title`/`n.body`）は **バックエンドが日本語ハードコードで保存**（`esimRetryService.ts`）。全ユーザーに日本語表示。
- 通知**UI枠**（"NOTIFICATIONS" ラベル、"No new notifications"、aria-label）も英語ハードコード。

**方針（BaaSファースト・フロント主体）**：
1. **UI枠**：i18n化（5言語キー追加）。フロントのみ・即対応可。
2. **本文**：バックエンドの `type` を手掛かりに**フロントで翻訳**する。ただし現状 `type` が「遅延」と「最終失敗」で同じ `order_failed` のため区別不可。
   → **要バックエンド変更**：type を `order_delayed` / `order_fulfilled` / `order_failed` に細分化（`functions/src/esimRetryService.ts`）。フロントは `t("notifications.<type>.title/body")` で表示、未知typeは保存済みテキストにフォールバック。i18nキーを5言語追加。
   - ⚠️ これは `functions/` 変更 → **CLAUDE.md 準拠で別途承認**。UI枠のi18n（フロントのみ）だけ先行も可能。

---

## 影響範囲・検証
- ④③(UI枠)①②：フロントのみ（`deriveEsimStatus`/`ActiveEsimSummary`/`Step6Esim`/`OrderDetailPage`/i18n）。
- ③(本文)：`functions/src/esimRetryService.ts`（type細分化）＋フロント翻訳＋i18n。functions は共有デプロイのため反映は別途指示。
- 検証：型チェック、`esimStatus.test.ts` 追加ケース、client テスト、dev チャンネルで表示確認。

## 確認したい決定事項
1. **ICCID**：詳細のみ残す（推奨）／全削除／現状維持 — どれ？
2. **失敗注文内の "Contact support →"** も消す？（推奨は残す）
3. **通知本文のi18n**：バックエンドの type 細分化まで含めてやる？（functions承認が要る）。まず UI枠だけ先行でも可。
4. ④（ステータス判定バグ修正）は上記方針で実装してよい？

---

## 実装記録（確定・2026-07-06・ユーザー承認済み）

**決定事項**：① ICCID＝**全削除**／② 失敗注文の Contact support は**残す**＋**問い合わせフォーム（/app#contact）へ**、下部共通行（Contact support/Buy another eSIM）は削除／③ 通知は**本文まで完全対応**（functions type 細分化＋フロント翻訳）／期限＝**「Valid for N days · from activation」**（`order.planId → plan.validityDays`）。

**変更ファイル**
- ④ステータス：`esimStatus.ts` の `activated` を `lastActiveAt != null || (dataRemaining<dataTotal)` に変更（`status==="active"` は発行マーカーなので除外）。`esimStatus.test.ts` に回帰ケース追加。
- 期限：`esimStatus.ts` に `formatEsimExpiry()` を追加。`useMyPageData.ts` で plans を購読し `bappyPlanId/planId → validityDays` を join（`activeEsimList` に `validityDays`/`planName` 補完）。`ActiveEsimSummary.tsx`（`validityDays` prop）と `OrderDetailPage.tsx`（`order.planId` から plan 取得）で表示。
- ① ICCID：`ActiveEsimSummary.tsx` / `Step6Esim.tsx` / `OrderDetailPage.tsx` から削除。
- ② ボタン：`OrderDetailPage.tsx` 下部共通行を削除。失敗注文の Contact support の href を `/app#contact` に変更。
- ③ 通知：`functions/src/esimRetryService.ts` の遅延通知 type を `order_delayed` に。`shared/types.ts` の `FsNotification.type` に `order_delayed` を追加。`Notifications.tsx` を i18n化（UI枠＋`t(mypage.notifications.types.<type>.title/body, {defaultValue})`）。i18n 5ファイルに `mypage.notifications` を追加。

**検証**：client 型チェック・テスト27件、functions build・テスト34件、build 通過。dev チャンネルで order `bwov753…` を確認：eSIM Status=**Ready to Install**／**Validity 7 days · from activation**／**ICCID非表示**／**Buy another eSIM削除**。デプロイ済みチャンクで `Buy another eSIM=0` `app#contact=1` `from activation=1` `ICCID=0` を確認。

**別件（今回の対象外・既存問題）**：MyPage の「YOUR eSIM」カードが表示されない。原因は今回の変更前からの既存挙動（`useMyPageData` の `esim_links` を `where(userId)+orderBy(createdAt)` で購読しており、複合インデックス未作成でクエリが失敗している可能性が高い）。要別途調査。

**未反映（ユーザー指示待ち）**：本番 hosting（`dev`→`main`→`firebase deploy --only hosting`）／functions（`firebase deploy --only functions`。type 変更の反映。未反映でもフロントは fallback で無害）。
