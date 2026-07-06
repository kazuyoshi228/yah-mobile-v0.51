# 実装設計書：ユーザードキュメント作成の一本化（useAuth 二重作成の解消）

対象ブランチ: `dev` ／ 作成: 2026-07-06 ／ ステータス: **提案（要承認）**
出典: Manus 総合評価レポート「4.2 改善が必要な箇所：ユーザードキュメントの二重作成」
関連: [firestore_schema.md](./firestore_schema.md)

> 🚨 CLAUDE.md の実装フロー準拠。本書の承認後に実装する。**本変更はフロント（`useAuth.ts`）のみ。`functions/` と `firestore.rules` は変更しない**（`onUserCreated` トリガーは現状維持）。デプロイは hosting のみ・別途ユーザー指示。

---

## 1. 背景・現状

`users/{uid}` ドキュメントを **2つの経路が作成**しており、責任が重複している。

### A. `onUserCreated`（Cloud Function・権威）— `functions/src/triggers.ts:29`
- `auth.user().onCreate`（1st-gen Auth トリガー）。Auth ユーザー作成時に**一度だけ**発火。
- doc が無ければ作成。**role を正しく判定**（オーナーメールなら `admin`、他は `user`）。
- **Custom Claims `{ admin }` を `setCustomUserClaims` で付与**（＝管理者判定の唯一の権威。`useAuth` は `tokenResult.claims["admin"]` を読む）。
- doc が既存なら `lastSignedIn` を更新。

### B. `useAuth` の client `setDoc`（フォールバック）— `client/src/_core/hooks/useAuth.ts:77-92`
- `onSnapshot` で doc が**存在しない場合のみ** `setDoc(..., { merge: true })` で作成。
- role を **`"user"` にハードコード**（オーナーの `admin` を考慮しない）。Custom Claims は触らない。

### 問題点
1. **冗長・責任不明確**：同じ doc を server（権威）と client（フォールバック）の双方が作成。
2. **role の取り違えリスク**：B は常に `role:"user"` を書く。初回ログインの競合で B が A の後に走ると、`merge` で `role` を `user` に上書きしうる（※現状は `firestore.rules` が role 変更を拒否するため実害は限定的だが、コンソールエラーや Firestore role と Custom Claims の不整合を招く）。
3. B のコメントは「ピュア BaaS 設計」を掲げるが、実際は A（トリガー）が権威として並存しており、設計思想が二重化している。

---

## 2. 変更方針

### 採用案（Option A・推奨）：client の作成を廃止し、`onUserCreated` に一本化
- `useAuth.ts` の `onSnapshot` ハンドラ内、**doc 不在時の `setDoc` 作成ブロック（L77-92 の `else`）を削除**。
- doc 不在時は「トリガーが作成するまで待つ」だけにする（`dbUser` は `null` のまま）。`useAuth` は既に `dbUser ?? fbUser 由来の最低限情報` で state を構築しているため（L116-128）、**doc 未生成の一瞬でもアプリは動作する**（ログイン済み・プロフィールは反映待ち）。
- 作成の権威を **`onUserCreated`（role 判定＋Custom Claims 付与）に集約**。責任が明確になり、role 取り違えの経路が消える。

**削除対象（L77-92 概略）:**
```ts
} else {
  // ドキュメントが存在しない場合は、バックグラウンドで作成処理を走らせる
  const ts = serverTimestamp();
  setDoc(userDocRef, { uid, name, email, loginMethod, role:"user", status:"active", createdAt:ts, lastSignedIn:ts, updatedAt:ts }, { merge:true })
    .catch(...);
}
```
→ `else` ブロックごと削除。併せて未使用になる import（`setDoc`, `serverTimestamp`）を除去し、L59-60 のコメントを実態に合わせて更新（「作成は onUserCreated トリガーが担う」）。

### 代替案（Option B・保険重視）：client はフォールバックを残すが権威フィールドを書かない
- doc 不在が一定時間続く場合のみ、**`role`/`status` を含めずに**最低限の bootstrap を書く案。
- ただし `firestore.rules` の users 作成条件は `role` 必須（`"user"` のみ許可）のため、role を外すと**作成が rules で拒否される**可能性が高い。→ ルール変更が必要になり「rules 不変」の前提を崩すため**非推奨**。

→ **Option A を推奨**。

---

## 3. 影響範囲・リスク

- **影響ファイル**：`client/src/_core/hooks/useAuth.ts` のみ（約12行削除＋import/コメント整理）。`functions/`・`rules`・他コンポーネントは無変更。
- **`lastSignedIn`**：現状、B は初回作成時のみ、A（onCreate）は一度きりの発火のため、**そもそも毎ログインでは更新されていない**（＝本変更による回帰なし）。毎回更新したい場合は別途トリガー設計が必要（本書の対象外・別途提案）。
- **リスク（唯一）**：`onUserCreated` が**恒久的に失敗**した場合、これまで client フォールバックが自己修復していた doc が作られない。
  - 発生確率は低い（Auth トリガーは安定・我々は今回デプロイ済みで稼働確認可能）。
  - 失敗しても `fbUser` フォールバックで**アプリは動作**（購入は `ordersInitCheckout` が `userId=uid` で書くため user doc 非依存）。影響はプロフィール表示のみ。
  - 監視：`onUserCreated` は失敗時に `logger.error` を出力済み。必要なら将来 `notifyOwner` 連携を追加（本書の対象外）。

---

## 4. 検証計画

1. `npx tsc --noEmit -p tsconfig.json`（未使用 import 削除の確認含む）。
2. `npx vitest run --config vitest.client.config.ts`（既存27件が通過）。
3. dev プレビューで手動確認：
   - **新規 Google アカウントでログイン** → 数秒以内に `users/{uid}` が生成され、マイページにプロフィールが反映される（＝トリガー単独で機能）。
   - **既存アカウントで再ログイン** → 正常表示・role/admin 判定（Custom Claims）が維持される。
   - オーナーアカウント（`admin`）でログイン → 管理画面アクセス可（claims 由来）を確認。
   - ログイン直後の一瞬 doc 未生成でも UI が壊れない（fbUser フォールバック）ことを確認。
4. `dev` にコミット（hosting 反映はユーザー指示で別途）。

---

## 5. デプロイ

- **hosting のみ**（client 変更）。dev チャンネル確認 → 本番 hosting は明示指示で。
- **functions デプロイ不要**（`onUserCreated` は無変更）。

---

## 6. 非対象
- `firestore.rules` / `functions/` の変更。
- `lastSignedIn` を毎ログイン更新する仕組み（別途）。
- Google ログイン同意画面の遷移先ドメイン（`...firebaseapp.com`→`yah.mobi`）変更（別テーマ・別途設計）。
