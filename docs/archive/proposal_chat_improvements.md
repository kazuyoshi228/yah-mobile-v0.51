# 実装提案書 — chat-yah-mobi 改善（2026-07-07 時点）

対象: AIチャットサポート（本番 chat.yah.mobi ／ dev チャンネル）
目的: dev 実機テストで判明した不具合・要望を優先度付きで整理し、順に実装する。

---

## 0. 現状サマリ（どこまで反映済みか）
- **本番稼働中（chat DB / Functions は本番共有）**: 管理者判定の堅牢化、計測ループ、L1自動ドラフト、3分岐ツリー、言語追従/既定英語、resolved基準、CONTACT誘導=エスカレーション。
- **dev のみ（本番hosting未反映）**: 上記のうち**クライアント画面**（失敗分析カード、承認フィルタ、CONTACT誘導ボタン、既定英語 等）。→ 本番反映は `pnpm deploy:hosting`（未実施・GO待ち）。
- **未処理**: 下記バックログ。

---

## 1. バックログ（優先度順）

| # | 項目 | 優先 | 担当 | 状態 |
|---|---|---|---|---|
| A | 旧エスカレーションの掃除（既存 escalated を false 戻し） | P0 | ユーザー実行 | **スクリプト済**（`reset_escalations.mjs`）→ 実行待ち |
| B | **問い合わせフォーム誘導を chat 一覧＋履歴に明示**（新要件） | P0 | AI | 本提案で設計 |
| C | モバイルでチャットが上にスクロールできない | P0 | AI | 本提案で設計 |
| D | ウィジェットにお客様ログイン導線が無い | P1 | AI | **要: ログイン方式の確認** |
| E | 本番hosting反映（chat.yah.mobi に最新画面） | P1 | ユーザー実行 | dev検証後 |
| F | バンドル分割（widget/admin）／rulesテスト／functions v6／lib gitignore | P2 | AI | 任意・次段 |
| G | App Check enforcement（監視先行・コンソール） | P2 | ユーザー | 監視中 |

---

## 2. 個別設計

### B. 問い合わせフォーム誘導を chat 一覧＋履歴に明示（新要件）【P0】
**要望**: 「問い合わせフォームに飛んだユーザー」が、chat list とチャット履歴で分かるようにする。

**定義**: 「飛んだ」＝AIが解決できず `resolved=false` で**フォームへ誘導した**時点（サーバ側で確実に検知）。※実際のクリック検知は L2（後述・任意）。

**変更**:
1. `functions/src/triggers/onVisitorMessageCreated.ts`（`handleEscalation`）
   - 既存の `escalated:true` に加え、`escalationType:"contact_form"` と `escalatedAt: serverTimestamp()` をセッションに記録。
2. `client/src/hooks/useFirestoreAdmin.ts`
   - `ChatSessionDoc` に `escalatedAt?` / `escalationType?` を追加してマップ。
3. `client/src/pages/admin/AdminChatListFirebase.tsx`
   - **一覧**: 該当セッションに「**📮 問い合わせフォーム誘導**」チップ＋日時を表示（現状の赤バッジをこの意味に統一）。
   - **履歴（右ペイン）**: メッセージ描画で `resolved===false` の AI メッセージの下に「**→ お問い合わせフォームへ誘導（エスカレーション）**」の区切り表示を出す。そのため `ChatMessage` 取得に `resolved` を追加。
4. （任意・L2）実クリック記録: ウィジェットの「フォームを開く」押下で `chat_messages` に role=visitor の系統メッセージ or Callable で記録 → 「実際に遷移」を区別。**まずは L1（誘導時点）で足りる**。

**非対象**: rules 変更なし（Functions が Admin SDK で書く）。

### C. モバイルのスクロール不可【P0】
**症状**: 長いAI回答の上側が見えず、上スクロールできない（モバイル）。
**原因（推定）**: ウィジェットパネルが固定高 `520px`＋`fixed bottom-6 right-6`。モバイルで①パネルが縦に収まらない/余白過多、②`ScrollArea`(flex-1) 内のタッチスクロールが効きにくい、③自動 `scrollIntoView` が毎回最下部へ寄せる。
**変更（`client/src/components/ChatWidgetFirebase.tsx`）**:
1. パネルを**レスポンシブ化**: 小画面は実質フルスクリーン（`inset` 近似・`h-[100dvh]`系）、`sm:` 以上で従来の 380×520 フローティング。固定 `height:520px` を `max-h` ＋ `dvh` ベースに。
2. `ScrollArea` に**明示的な高さ制約**（親が min-h-0 を持つ flex-col になるよう `min-h-0` を付与）＋ タッチスクロール（`overscroll-contain` / `touch-action`）を担保。
3. 自動スクロールは**最下部にいる時だけ**追従（上に手動スクロール中は追従しない）に変更し、遡って読めるように。

### D. ウィジェットのお客様ログイン導線【P1】
**現状**: `useFirebaseAuth` が匿名サインインするのみ。ログイン入口が無い＝個別対応（注文/eSIM参照）に入れない。
**設計**:
- ウィジェットに「**Sign in**」導線（ヘッダ or 個別対応が要る時に提示）。ログイン後 `uid` 一致で `buildCustomerContext` が注文/eSIMを参照。
- 匿名→ログインは **account linking**（`linkWithCredential`）でセッション継続。
- **🚫 ブロッカー**: ウィジェットのログインは **yah.mobi のお客様アカウントと同じ方式**でなければ `uid` が一致しない。→ **方式（Google／メール＋パスワード／メールリンク等）の確定が必要**。
- 方式確定後: 該当プロバイダの sign-in UI をウィジェットに追加（管理者Google認証とは別レイヤ）。

### E. 本番hosting反映【P1】
- dev で B/C（＋既存の言語/エスカレーション修正）を確認 → `pnpm deploy:hosting` で chat.yah.mobi に最新画面を反映。

### F. 品質（P2・任意）
- バンドル分割（訪問者widgetに管理画面コードを載せない）／`firestore.chat.rules` の回帰テスト／`firebase-functions` v6 化／`functions/lib` を gitignore。

---

## 3. 推奨実装順
1. **A**（ユーザー: `reset_escalations.mjs --write`）で旧バッジ掃除
2. **B**（AI）フォーム誘導の可視化 → **C**（AI）モバイルスクロール修正 … まとめて実装・`tsc`/build・コミット
3. ユーザー: `pnpm deploy:functions` ＋ `pnpm deploy:dev` → dev で B/C 確認
4. **D**（ログイン方式が決まり次第）設計→実装
5. 全部OKで **E** 本番 `pnpm deploy:hosting`
6. 余力で **F**

---

## 4. 検証・デプロイ方針
- 各実装後: `tsc`（client/functions）＋ `vite build`。UIは dev ウィジェット/管理画面で目視。
- デプロイはユーザー環境（firebase認証）。本番hostingは明示GO時のみ。
- ガードレール: chat 側のみ・`(default)` は read-only・yah.mobi 非干渉。
