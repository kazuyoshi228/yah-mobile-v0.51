# Firebase デプロイ指示書（MANUS / 運用担当者向け）

`yah.mobile` のBaaSファースト対応（バックエンドの非正規化、Firestoreネイティブ連携、比較表のNoSQL化、プラン順序調整等）が完了し、`main` ブランチに全て統合・Pushされています。

以下の手順に従って、**本番プロジェクト（`yah-mobile-v1-3ed24`）へのビルドおよび一括デプロイ**を進めてください。

---

## 1. 最新コードの取得とプロジェクト設定
現在作業中のローカル環境にて、GitHubの `main` ブランチから最新の変更を取得し、ターゲットとなるFirebaseプロジェクトを指定します。
```bash
git fetch origin
git checkout main
git pull origin main

# デプロイ先を本番プロジェクト(yah-mobile-v1-3ed24)に設定
npx firebase use yah-mobile-v1-3ed24
```

## 2. パッケージのインストールとビルド
フロントエンド（Vite / React）とバックエンド（Cloud Functions）のそれぞれをビルドします。

### 2.1 フロントエンドのビルド
プロジェクトのルートディレクトリで実行します。
```bash
pnpm install
pnpm run build
```
※ ビルドが成功すると、デプロイ用のファイルが `dist/public` に生成されます。

### 2.2 バックエンド（Functions）のビルド
```bash
cd functions
pnpm install
pnpm run build
cd ..
```
※ Cloud Buildのエラー回避のため、pnpm環境の問題を修正済みです。必ず `pnpm install` を実行してください。

## 3. Firebase への個別デプロイ（Hosting と Functions のみ）
ビルドが完了したら、Hosting（フロントエンド）と Functions（バックエンド）のみをデプロイします。
※セキュリティのため、Firestoreのルールやインデックスは自動デプロイの対象外とし、データ破棄や権限事故を物理的に防ぎます。

プロジェクトルートで以下のコマンドを実行してください。
```bash
npx firebase deploy --only hosting,functions --project yah-mobile-v1-3ed24 --non-interactive --force
```
※ エラーが出た場合は、出力されるログ（特に `functions` デプロイ時のエラー）を確認してください。

## 4. GCPコンソールでの設定作業（デプロイ後）

今回のバージョンからデータ最適化のためアーキテクチャが変更されています。

1. **TTL（Time-To-Live）ポリシーの有効化**
   Firebase Consoleの Firestore Database > インデックス（Indexes） > TTL タブにて、以下の2つのTTLポリシーを作成してください。
   - コレクショングループ: `stripe_events` / タイムスタンプフィールド: `expiresAt`
   - コレクショングループ: `esim_retry_jobs` / タイムスタンプフィールド: `expiresAt`

2. **比較表データの初期設定**
   比較表（Comparison Table）の仕様が完全なNoSQL（単一ドキュメント）にリニューアルされました。
   - デプロイ後、管理画面（`/admin`）の「How we compare」タブを開き、「+ Add row」「+ Add column」から再度比較表のデータを作成し直してください。

## 5. 動作確認項目
デプロイ完了後、以下の3点が正常に動作しているか確認してください。

1. **フロントエンドの稼働**: `https://yah-mobile-v1-3ed24.web.app/` 等の本番URLにアクセスし、Viteアプリが正常に表示・動作すること。
2. **管理画面（/admin）**: 管理者アカウントでログイン後、エラーが出ず、比較表（How we compare）が正常に編集・保存できること。
3. **エラーログの確認**: Firebase Console にて、Functions のエラーログ（特に Permission Denied などの権限エラー）が発生していないこと。
