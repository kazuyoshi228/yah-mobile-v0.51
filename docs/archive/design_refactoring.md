# 設計図 — 全コード検査＆リファクタリング

対象: chat-yah-mobi 全ソース（client / functions / shared）
状態: **設計（実装前・承認待ち）**
原則: **挙動は一切変えない**（純粋なリファクタ）。検証は tsc / build / ルールテスト14件 / SIM100件で担保。

---

## 1. 検査結果サマリ

| 領域 | 所見 |
|---|---|
| 総行数 | 約13,900行（client+functions+shared） |
| 🔴 肥大ファイル | `ChatWidgetFirebase.tsx` **1,008行**／`onVisitorMessageCreated.ts` 410行／`ai.ts` 388行 |
| 🔴 未使用コード | `AIChatBox.tsx`(335行・streamdownごと)／**ui/ 34コンポーネント未使用**（chart/carousel/menubar等 約3,500行） |
| 🔴 未使用依存 | `@hookform/resolvers` `date-fns` `framer-motion` `nanoid` `tailwindcss-animate` `zod` `streamdown`（＋ui削除で浮くradix系） |
| 🟠 i18n肥大 | `shared/i18n.ts` 637行中、**81キー中約71キーが未使用**（旧ホームページの home_* 等） |
| 🟠 git汚れ | `functions/lib`（ビルド成果物）**30ファイルが追跡中**。旧 `qrResend.js` 等の残骸も混入 |
| 🟡 重複 | `parseI18n`(widget) と `parseLabel`(FlowTree) が同種処理を各自実装 |
| 🟡 型 | client に `any` 8箇所（functionsは0） |
| ✅ 健全 | functions構成・ルール・hooks・命名は概ね良好。googleapis は onSessionEnded(Sheets) で現役 |

## 2. 実施内容（2段階）

### Tier 1 — 安全な掃除（削除のみ・挙動不変）
1. **未使用コンポーネント削除**: `AIChatBox.tsx`、`ui/` 未使用34ファイル（削除後に相互参照を再確認）
2. **未使用依存の削除**: 上記7パッケージ＋削除で浮いた radix 系を再スキャンして除去（`pnpm remove`）
3. **i18n未使用キー削除**: `t()` 使用箇所を厳密再確認のうえ home_* 等を削除（637行→約150行）
4. **`functions/lib` を gitignore＋追跡解除**（旧qrResend残骸も一掃。デプロイは predeploy tsc で再生成されるため影響なし）
5. **client の `any` 8箇所を型付け**

### Tier 2 — 構造リファクタ（分割・共通化・挙動不変）
6. **`ChatWidgetFirebase.tsx`（1,008行）を分割**: `components/widget/` 配下へ
   - `labels.ts`（CONTACT/AUTH等の多言語表）・`parseI18n.ts`・`LoginPanel.tsx`・`QrGuide.tsx`・`FlowView.tsx`・`ChatView.tsx`・`SurveyView.tsx`＋本体は状態と配線のみ（~300行）
7. **`onVisitorMessageCreated.ts`（410行）を分割**: `utils/rateLimits.ts`・`utils/customerContext.ts`・`utils/classifyFailure.ts` へ抽出（トリガー本体はStep流れのみ）
8. **`ai.ts`**: システムプロンプト構築を `utils/prompt.ts` へ抽出
9. **parseI18n/parseLabel を共通化**（shared or client/lib）

### 見送り（別タスク・要個別承認）
- `firebase-functions` v5→v6（破壊的変更）
- バンドル分割（admin を React.lazy 遅延読込。効果大だが挙動に触れるため希望あれば別途）
- `onSessionEnded` の Sheets 連携見直し（Gmail同様に非稼働の可能性。挙動変更になるため対象外）

## 3. リスクと担保
- 削除対象は**参照ゼロを機械確認済み**。分割は**移動のみでロジック不変**。
- 検証: `tsc`（client/functions）＋ `vite build` ＋ `npm run build`(functions) ＋ **`pnpm test:rules`(14件)** → デプロイ後に **SIM100件**（ユーザー実行）で挙動不変を実測確認。
- コミットは Tier ごとに分割（問題時に revert しやすく）。

## 4. 効果
- コード**約4,500行削減**（〜3割減）・依存10個前後削減 → ビルド/読解/保守が軽く
- 巨大ファイル解消で今後の変更が安全に（widget/トリガーは今後も触る中心部）
