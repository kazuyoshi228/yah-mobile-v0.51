# Gmailを使った自動メール送信の設定手順

システムからGmail（nodemailer）を使って自動でメールを送信するために、以下の手順で設定をお願いします。

## 1. Gmail（Googleアカウント）の準備
送信用に使用するGoogleアカウント（社長のアドレス等）でログインし、以下の設定を行います。

### 1-1. 2段階認証を有効にする
アプリパスワードを発行するためには、Googleアカウントの2段階認証が必須です。
1. [Googleアカウントのセキュリティページ](https://myaccount.google.com/security) にアクセスします。
2. 「Google へのログイン」セクションで **2段階認証プロセス** がオンになっているか確認します。
3. オフの場合はクリックして、画面の指示に従いオンにしてください。

### 1-2. アプリパスワードを発行する
1. 同じく [セキュリティページ](https://myaccount.google.com/security) にある検索窓（上部）で **「アプリパスワード」** と検索して選択します。
2. 本人確認（パスワード入力）を求められたら入力します。
3. 「アプリ」という項目で、わかりやすい名前（例: `yah-mobile-system`）を入力し、**「作成」** をクリックします。
4. **16桁のパスワード** が表示されます。これが「アプリパスワード」です。
   > [!IMPORTANT]
   > このパスワードは一度しか表示されません。この後の設定で使うので、必ずメモするかコピーしておいてください。

---

## 2. Firebaseへの環境変数（Secret）登録

システム（Cloud Functions）が先ほどのGmailアドレスとアプリパスワードを使えるように、Firebaseに安全に登録します。

ターミナル（またはコマンドプロンプト）を開き、`yah-mobile-v4`（プロジェクトのルート）または `functions` ディレクトリで以下のコマンドを実行してください。

### 2-1. GMAIL_USER（送信元メールアドレス）の登録
```bash
firebase functions:secrets:set GMAIL_USER
```
実行すると `? Enter a value for GMAIL_USER [hidden]` と聞かれますので、**送信に使うGmailアドレス**（例: `info@yah.mobi` や `yourname@gmail.com`）を入力してEnterを押します。

### 2-2. GMAIL_PASS（アプリパスワード）の登録
```bash
firebase functions:secrets:set GMAIL_PASS
```
同様に値を聞かれますので、先ほど発行した **16桁のアプリパスワード**（スペース無し）を入力してEnterを押します。

### 2-3. MAIL_FROM（送信元名・任意）の登録
メールの送信元として表示される名前を設定します。
```bash
firebase functions:secrets:set MAIL_FROM
```
値として `"yah.mobile <送信に使うGmailアドレス>"` を入力してください。
例: `yah.mobile <info@yah.mobi>`

---

## 3. デプロイと動作確認

Firebaseに新しい設定とコードを反映させるため、デプロイを行います。

### 3-1. パッケージのインストール
（すでに設定済みの場合はスキップ可能ですが、依存関係を最新にするため念のため実行してください）
```bash
# プロジェクトルートで実行
pnpm install
```

### 3-2. Cloud Functionsのデプロイ
```bash
# プロジェクトルートで実行
npm run deploy --only functions
# もしくは
firebase deploy --only functions
```

デプロイ完了後、テスト購入などでシステムからのメールが届くようになれば設定完了です！
（無料のGmailアカウントの場合、1日の送信上限は500件になります）
