# 設計図：メールサインインの追加

対象ブランチ: `dev` ／ 作成: 2026-07-17 ／ ステータス: **設計（要承認→実装）**

## 背景・目的

サインインが Google 一択のため、Google を使えない/使いたくない訪問者が購入に到達できない。メールでのサインインを追加して CVR を上げたい。

## 調査で確定した事実（実コード・本番データ）

1. **サインインは決済前の必須ゲート**
   購入ドロワーは `step 0 = Step0Plan` → `step 1 = Step3Login` → `step 2 = Step4Payment`（`PurchaseDrawer.tsx:309-311`）。`Step3Login.tsx:16` は認証済みなら自動で決済へ前進し、未認証だと Google ボタンしか無い。**サインインできない＝買えない**。

2. **Google のみ**
   `client/src/lib/firebase.ts:111-136`。PC は popup、モバイル/WebView（`FBAN|FBAV|Line|Instagram` を UA 判定・`firebase.ts:117-120`）は redirect。メール系・匿名はこのクライアントに無い。

3. **招待制は OFF＝誰でも購入可**
   本番 `system_config/access.inviteGateEnabled = false`（既定＝開放・`functions/src/db/allowedEmails.ts:15-24`）、`allowed_emails` は3件のみ。→ サインイン方法が実ボトルネックになりうる状態。

4. **eSIM の QR はメールで届く**
   `functions/src/webhooks.ts:341` が `buildEsimReadyEmail` → `sendEmail({ to: user.email })`。送信基盤は独自の Google Workspace SMTP relay（`functions/src/mailer.ts`）。→ **アカウントは配送に必須ではない**。MyPage（履歴・残量・topup）と注文紐付けのために存在する。

5. **`/users` の create ルールが `loginMethod == "google"` を強制**
   `firestore.rules:41`。→ メール認証を足すなら**セキュリティルールの変更が必須**（別途承認が必要）。

6. **Google 前提のコピーが5言語×6箇所**
   `loginReassure`「No password needed — sign in with Google in about 10 seconds.」／`cookieConsent.message`「Sign-in is handled securely by Google …」／`cantLogIn`「yah.mobile uses Google login …」／`signInWithGoogle`／`secureLogin`／`drawer.signInDesc`。

7. **ログイン離脱は今の GA4 で測れる**
   `select_item`(item_list_id=`drawer_plans`・`Step0Plan.tsx:53`)＝ログイン画面到達／`login`(`Step3Login.tsx:16`)＝ログイン通過／`add_payment_info`(`Step4Payment.tsx:11`)＝決済到達。**差分＝ログイン壁での離脱**。

## CVR への評価（正直なところ）

**上がる見込みはあるが、理由は「メールの方が速いから」ではない。** 一般ユーザーには Google のワンタップの方が速く、メールを既定にすると全体の摩擦はむしろ増える。効くのは **「Google が使えない人」を救う**点：

- **アプリ内ブラウザ（Instagram / LINE / Facebook）**：Google は埋め込み WebView での OAuth をポリシーで拒否する（`disallowed_useragent`）。現行コードは WebView を検出して redirect に切り替えているが（`firebase.ts:117-120`）、**redirect でも Google 側が WebView を弾く**ため、SNS 流入は詰む可能性が高い。旅行系は SNS 流入の比率が大きく、ここは effectively 0→1 の改善になりうる。**ただし実機検証が未了（QA-2）なので、これは「高確度の仮説」であって確認済みの事実ではない。**
- Google アカウントを持たない層／購入に Google を紐付けたくない層。

**根拠に使わない点（不確実なため）**：
- **中国本土**：zh-CN 対応済みだが、Firebase（identitytoolkit / googleapis）自体が本土で遮断されている可能性が高い。その場合サイト全体が Firebase 依存なので**メールを足しても解決しない**。別途検証が必要。

**より大きなレバーの存在**：QR がメールで届く以上、**ゲスト購入（サインイン廃止）**が技術的に成立し、CVR インパクトは最大。ただし orders / esim_links / rules / MyPage が `userId` 前提で改修が大きい。→ 今回は非対象、別途評価。

**推測より先に数字**：実装前に GA4 で `select_item(drawer_plans) − login` を見れば、ログイン壁で何人落ちているかが分かる。ここが小さければ投資対効果は低い。**先にこれを確認することを推奨**。

## 方式の比較

| | A: メール／パスワード | B: メールリンク（パスワードレス） |
|---|---|---|
| 決済フロー | ページを離れない ◎ | メールを見に行く＝離脱リスク △ |
| パスワード | 新規に考えさせる・忘れる・リセット導線が必要 | 不要。現行の「No password needed」訴求を維持できる |
| メアドの正しさ | **未検証のまま購入され得る → QR が届かない**（typo＝返金・サポート） | クリック時点で到達が証明済み ◎ |
| 実装量 | UI＋バリデーション＋リセット＋（検証） | UI＋リンク送信＋復帰処理 |
| WebView | 動く | 動く |

→ **B（メールリンク）を推奨**。A の「ページを離れない」利点は大きいが、**この商品はメールが配送経路そのもの**であり、未検証アドレスで購入されると QR が消える。typo を防ぐため検証を必須にすると結局ページを離れるので、A の利点は消える。

B の弱点は、メールが遅延／迷惑メール行きだと購入が止まること。Firebase Auth の標準メールは `noreply@<project>.firebaseapp.com` から出るため、**Firebase コンソールでカスタム SMTP（既存の Workspace relay）を設定**して到達率とローカライズを揃える。

## 変更対象と方針（案 B）

1. `client/src/lib/firebase.ts` — `sendSignInLinkToEmail` / `isSignInWithEmailLink` / `signInWithEmailLink` を追加。`actionCodeSettings.url` は既存の `loginHref`（`Step3Login.tsx:20-27` が plan/days/gb を保持する仕組み）を流用する。
2. `client/src/components/app/purchase-drawer/steps/Step3Login.tsx` — Google ボタンの下に「またはメールで続ける」。送信後は「メールを確認してください」状態へ。
3. 復帰処理 — 起動時に `isSignInWithEmailLink(location.href)` を判定してサインイン → `?open=true&plan=…` でドロワーを復元（既存の仕組みに乗る）。
4. `client/src/_core/hooks/useAuth.ts:111` — `loginMethod` を `"google" | "emailLink"` に拡張。
5. **`firestore.rules`（要承認）** — `/users` create の `loginMethod == "google"` を `in ["google","emailLink"]` に緩和。
6. i18n 5言語 — 新規キー＋上記6箇所の Google 前提コピーを修正。
7. Firebase コンソール（ユーザー作業） — メールリンク（パスワードレス）プロバイダを有効化／authorized domains 確認／カスタム SMTP 設定。

## 影響範囲・リスク

- **Auth は chat と共有**（同一 Firebase プロジェクト・名前空間分離なし）。匿名認証を無効化して chat を止めた事故の教訓から、**プロバイダ追加時も chat 側の想定を先に確認する**。追加自体は既存プロバイダに影響しない見込み。
- `loginMethod == "google"` を緩めるのはセキュリティルール変更。Rules テストを追加する。
- **同一メールでの Google／メールリンク衝突**：Firebase の「1メール1アカウント」設定次第でリンクまたは衝突。`linkWithCredential` の扱いを決める必要あり。
- メール到達率がそのまま購入完了率になる（B の本質的リスク）。

## 検証計画

1. **実装前**：GA4 で `select_item(drawer_plans) − login` のベースラインを取る。
2. `npx tsc --noEmit` / eslint / `npx vitest run --config vitest.client.config.ts`。
3. Rules テスト追加（`loginMethod: "emailLink"` で create 可・不正値は不可）→ `npx vitest run --config vitest.rules.config.ts`。
4. dev チャンネルで実機確認（iOS Safari／**Instagram・LINE のアプリ内ブラウザ**）。未了の QA-2 と合わせて実施。
5. 本番反映（hosting／rules）は別途ユーザーの明示指示。

## 非対象（別途評価）

- **ゲスト購入**：CVR インパクトは最大だが改修も最大。
- **Apple Sign In**：eSIM 対応端末（iPhone XS 以降）という性質上 iPhone 比率が高く、ワンタップで摩擦も小さいため実は有力。Apple Developer アカウントが必要。
- 死蔵コード：`loginMethod` の型整理。
