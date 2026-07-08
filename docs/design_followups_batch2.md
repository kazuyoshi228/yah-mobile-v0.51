# 設計書：改善バッチ2（chat連携・contact・admin・期限コミュニケーション・データ整理）

対象: `yah-mobile`（本リポジトリ）＋ `yah-chat-webdev`（chat.yah.mobi・別リポジトリ）
作成: 2026-07-08 ／ ステータス: **設計（要承認→実装）**
関連: [design_widget_login.md](./design_widget_login.md)（チャット内ログイン=D案）／[design_escalation_via_contact.md](./design_escalation_via_contact.md)／[design_decision_tree.md](./design_decision_tree.md)／[design_realorder_followups.md](./design_realorder_followups.md)

> 実コード・実データ調査済み（2026-07-08）。各節に現状の根拠を記載。

---

## A. yah.mobi でログイン済みなのに chat に反映されない（SSO）

### 現状（実コード）
- widget は **iframe（chat.yah.mobi）**。Firebase Auth の永続化は**オリジン別**のため、yah.mobi のログインは iframe に引き継がれない。iframe 側は**匿名 Auth に自動サインイン**。
- host⇔iframe の postMessage は既存（`yah:open/close/unread/resize`・オリジン検証あり）が、**認証系のメッセージは無い**。
- [design_widget_login.md](./design_widget_login.md)（D案）は「iframe 内で再ログイン」の設計＝**既ログインの引き継ぎは未カバー**。

### 方針（SSO＝トークン橋渡し。D案と共存）
同一 Firebase プロジェクトなので、ホストの IDトークン → カスタムトークン交換でそのまま同一 uid にサインインできる：

1. **販売側（本リポジトリ）**: `client/src/lib/chatBridge.ts`（新規）
   - widget iframe からの `yah:request-auth`（origin=chat.yah.mobi のみ受理）に対し、ログイン中なら `getIdToken()` を `yah:auth-token` で返す。ログアウト時は `yah:auth-none`。
   - `onAuthStateChanged` でログイン/ログアウト変化も通知（開いている widget に反映）。
2. **chat側（yah-chat-webdev）**:
   - `widget.js`: iframe⇔host のメッセージ中継に auth 系3種を追加（既存の origin 検証を踏襲）。
   - 新 callable **`ssoExchange({ idToken })`**: `verifyIdToken` → `createCustomToken(uid)`（同一 uid のみ・追加claimsなし）。
   - `ChatWidgetFirebase.tsx`: 起動時に `yah:request-auth` → トークン受領 → `ssoExchange` → `signInWithCustomToken` で **uid_real** にサインイン。進行中の匿名セッションは D案の **`claimSession`** で引き継ぐ（設計済・共通利用）。
3. 未ログイン訪問者は従来どおり匿名→（必要時）D案のログインパネル。

### セキュリティ
- postMessage は双方向とも **targetOrigin/origin を厳格検証**（既存パターン踏襲）。
- `ssoExchange` は IDトークン検証済み uid に対してのみ mint（権限昇格なし・admin claims なし）。
- `claimSession` の IDOR 防止は D案 §3 のまま。

### 影響・工数
- 販売側: 小（bridge 1ファイル＋初期化1行）。chat側: 中（widget.js/Widget/callable）。
- **chat側の実装は yah-chat-webdev リポジトリで別途実施**（本設計を持ち込む）。

---

## B. refund チャット → ログイン → 注文確認 → /contact へ引き継ぎ

### 現状（実コード）
- デシジョンツリーは3分岐のみ（購入/eSIM/その他）。**refund 分岐なし**。エスカレーションは `https://yah.mobi/contact` への**静的リンク（コンテキスト無し）**。
- /contact（ContactSection）: **URLパラメータのプリフィル未実装**・**refund カテゴリ無し**（6カテゴリ）。ログイン時は name/email 自動入力＋「最新注文ID」を自動添付済み。
- chat の AI はログイン済みなら `(default)` DB の orders/esim_links を読める（buildCustomerContext・実装済み）。

### 方針
**chat側（yah-chat-webdev）**
1. ~~ツリーに4つ目の分岐「返金・キャンセル」を追加~~ → **不採用（ユーザー決定 2026-07-08）**。冒頭は3分岐のまま。返金は**AIの意図検知のみ**でフロー（ログイン促し→注文確認→フォーム誘導）に合流させる（専用ボタンは出さない）。
2. refund フロー: **未ログイン → ログインを促す**（A の SSO で既ログインなら自動反映、それ以外は D案パネル）。
3. ログイン後、AI が buildCustomerContext の注文一覧から**対象注文・プラン名・金額を会話内で確認**。
4. 確認後、コンテキスト付き URL で /contact へ誘導：
   `https://yah.mobi/contact?category=refundCancel&orderId=<注文ID>&lang=<言語>`

**販売側（本リポジトリ）**
5. ContactSection に **URLプリフィル対応**：`category` / `orderId` / `lang` を読み取り初期値に。
6. カテゴリに **`refundCancel`（返金・キャンセル）** を追加（i18n 5言語＋detail 選択肢）。
7. `orderId` 指定時は該当注文を読み（本人の注文のみ・`userId==uid` ガード）、**プラン名・金額・注文日・状態を read-only カードで表示**（＝ユーザーが対象を確認できる）。
8. 送信時に `contact_inquiries` へ **`orderId` ＋ `orderSnapshot { planName, amountJpy, status, orderType }` ＋ `language`** を保存（callable input に zod `.nullish()` で追加）。

### 影響
- callable `submitContactInquiry` の入力拡張（後方互換・任意項目）。rules 変更なし。

---

## C. admin/inquiries に refund の注文情報・金額を表示

### 現状
InquiriesTab は問い合わせ内容のみ表示。**注文との突き合わせ・金額表示なし**（orderId は保存済みだが未表示）。

### 方針
1. 詳細パネルに **注文情報セクション**：B で保存する `orderSnapshot`（プラン/金額/状態/種別）を表示。スナップショット無し（過去分）は `orderId` → orders を admin 読取して表示。
2. `orderId` も無い場合は **email → users → 直近注文** を突き合わせて「この顧客の注文」を列挙（上位5件）。
3. refund カテゴリの問い合わせには **「この注文を返金する」ボタン**（E と同じ `adminRefundOrder` 呼び出し・確認ダイアログ付き）。

---

## D. 問い合わせメールが日本語（多言語化）

### 現状（functions/src/triggers.ts onContactCreated）
- 管理者向け通知＝日本語（**これは日本語のままで正**）。
- **顧客への自動返信も日本語固定**（субject「【yah.mobile】お問い合わせを受け付けました」）＝英語等の顧客に日本語が届く。

### 方針
- 自動返信を mailer.ts の **`normalizeLang` パターンで6言語化**（ja/en/ko/zh-CN/zh-TW/th。注文メールと同実装）。
- 言語ソース: B-8 の `contact_inquiries.language`（フォームが i18n.language を送る）。未設定は en フォールバック。
- 管理者向けは日本語のまま変更なし。

---

## E. admin/orders の並べ替え・検索・返金

### 現状
- `createdAt desc` 固定・**100件 limit・ソートUI無し・検索無し**。
- 返金は RefundsTab（**status=="failed" のみ**列挙）。`adminRefundOrder({orderId, reason})` callable は既存（Stripe返金＋未使用eSIMのprovider cancel＋webhook確定）。

### 方針（クライアント内完結・低リスク）
1. **ソート**: 取得済みデータの列ヘッダクリック（Date / Amount / Status / Plan）。
2. **検索**: テキストボックス1つで orderId / email / userId / planName の部分一致（クライアントサイド）。＋ステータスのドロップダウンフィルタ。
3. **件数**: limit 100→200＋「さらに読み込む」（startAfter ページング）。
4. **返金**: 注文詳細パネルに **「返金する」ボタン**（status が paid / fulfilled / failed の注文に表示。二重確認ダイアログ「¥N を返金します。取り消せません」）。`adminRefundOrder` を流用。
   - ⚠ 実装時確認: `executeRefund` が fulfilled 注文（使用開始後）でも安全に動くか精査（eSIM cancel は未使用時のみ可＝eSIMAccess仕様。使用済みは Stripe 返金のみになる旨を UI に注記）。

---

## F. 「いつまでにアクティベートしないと無効化」の伝達

### 事実（実測・API仕様）
- eSIMAccess は発行時に **`expiredTime` ≈ 購入+約6ヶ月**を設定＝**インストール期限**。期限内に未有効化だと `UNUSED_EXPIRED`（失効）。自動通知はプロバイダ側に無し。
- 現状の伝達: **マイページの「Install by <日付>」のみ**（§①で実装済み）。メール・FAQ・購入完了画面には無し。

### 方針（3点＋バックログ1点）
1. **eSIM発行完了メールに期限を明記**（6言語）：`buildEsimReadyEmail` に `installBy`（expiryDate）を渡し、「**Install by <日付>** — 期限までにインストールしてください。未使用のまま期限を過ぎると失効します」を追記。呼び出し元（webhooks.ts fulfillEsim / esimRetryService）は detail.expiryDate を保持済み。
2. **FAQ 追加**（5言語）：「eSIMはいつまでに設定が必要？」→「発行から約6ヶ月（マイページに正確な日付）。データの有効期間（7日等）は**有効化した時点から**開始」。
3. **購入完了画面（Step6Esim）に Install by 表示**（esimLink.expiryDate から・1行）。
4. （バックログ）失効30日前の未有効化リマインダーメール（scheduled）— v1.0 後。

---

## G. 「eSIMは何回繋ぎ直せる？」への回答

2つの意味を区別して伝える：

| 意味 | 回答 |
|---|---|
| **ネットワーク接続のON/OFF・機内モード・再起動** | **無制限**（データ残量・期限内なら何度でも） |
| **プロファイルの削除→再インストール** | api_notes に「削除済みeSIMの再インストール**可**（原QR/新QRの別は要確認）」とあるが、**回数上限・手順は eSIMAccess に正式確認が必要** |

### アクション
1. **eSIMAccess に確認**（あなた or サポート経由）：同一QRの再DL可否／回数上限／削除後の復元手順。→ ✅ **確認済（2026-07-09・実機調査）**
2. 確認まで FAQ は**安全側**で記載（5言語）。✅ 実施済（P0）
3. **QR発行完了メールにも「削除しないで」注意を明記**（6言語・⚠️太字）。✅ 実施済
4. 確認結果でFAQ・メール文言を更新。→ ✅ **FAQ（5言語）を事実ベースに更新済（2026-07-09）**

### 確認結果（eSIMAccess 公式）— [[esimaccess-reinstall-rules]]
- **同一QR再DL/再インストール可**：削除後は初回と同じQRを再スキャンで再インストール可（当社QRはマイページに常時あり）。
- **回数**：実質**同一デバイスIDに1回**。別デバイスへの共有/転送は不可。数値上限は非公開。
- **復元**：有効化**前**＝同一QRで再インストール可／有効化**後**に削除＝復元困難・新規購入の可能性。
- **反映**：FAQ「Can I delete and reinstall my eSIM?」を有効化前後で分けた事実ベース文言に更新（5言語）。発行メールの注意はそのまま整合。

---

## H. Bappy プランは残す？消す？

### 実データ（2026-07-08 read-only）
- 旧Bappyプラン **5本・全て `isActive:false`**（購入UIには一切出ない）。
- **34注文中31件**が `planId`/`bappyPlanId` でこれらを参照（旧注文の表示フォールバック・管理画面照合）。

### 結論：**残す（isActive:false のまま）を推奨**
- 実害ゼロ（UIに出ない・課金に無関係）。削除すると旧注文の表示解決・照合が壊れ得る。
- 見た目の整理が必要なら PlansTab に「アーカイブ折りたたみ」を足す程度（任意・低優先）。

---

## 実施順の提案

| 優先 | 項目 | リポジトリ | 状態 |
|---|---|---|---|
| **P0** | D 自動返信メール6言語化 | 本リポジトリ(functions) | ✅ dev |
| **P0** | E admin/orders ソート・検索・返金 | 本リポジトリ(client) | ✅ dev |
| **P0** | F 期限コミュニケーション（メール/FAQ/Step6） | 本リポジトリ | ✅ dev |
| **P1** | B-5〜8 /contact プリフィル＋refundカテゴリ＋orderSnapshot | 本リポジトリ | ✅ dev |
| **P1** | C admin/inquiries 注文情報表示＋返金ボタン | 本リポジトリ | ✅ dev |
| **P1** | A SSO（chatBridge＋ssoExchange。widget.js変更不要） | 両リポジトリ | ✅ dev（両） |
| **P1** | B-1〜4 refund分岐＋ログイン誘導＋確認フロー | chat側 | ✅ dev |
| — | G eSIMAccess確認＋FAQ安全側記載＋発行メール明記 | あなた確認+本リポジトリ | ✅ 安全側実施済 |
| — | H Bappyプラン＝残す（作業なし） | — | ✅ 結論のみ |

## 本番反映手順（両リポジトリ・要ユーザー指示）

**yah-mobile（本リポジトリ）**
- hosting: `npm run build && node scripts/prerender.mjs && firebase deploy --only hosting`
  （FAQ・Step6・/contact プリフィル・admin/orders・admin/inquiries・chatBridge）
- functions: `firebase deploy --only functions:stripeWebhook,functions:esimRetryJob,functions:submitContactInquiry,functions:onContactCreated`

**chat（yah-chat-webdev・スコープ付き）**
- functions: `pnpm deploy:functions`（ssoExchange 新設・ai/prompt/customerContext/trigger 更新）
- hosting: `pnpm deploy:hosting`（SSO・buildContactUrl）
- seed: **不要**（返金分岐は不採用。ツリーは3分岐のまま変更なし）

**SSO の前提**：CSP は現状 `chat.yah.mobi` を frame/script/connect に許可済み。postMessage の双方向 origin 検証済み。ssoExchange の Cloud Run invoker（allUsers）付与を確認（[[topup-iam-invoker-401]] と同様の取りこぼし注意）。

## 検証計画（共通）
- 本リポジトリ: `tsc --noEmit`＋`vitest`（client/functions）＋build → dev チャンネル目視 → dev コミット。**本番反映は別途指示**。
- chat側: 同リポジトリのガードレール（CLAUDE.md）に従い dev 検証 → 本番は別途指示。
- E の返金ボタンは **本番データに触れるため、実注文での動作確認はあなたの合図後**（テスト注文 or 実際の返金依頼時）。
