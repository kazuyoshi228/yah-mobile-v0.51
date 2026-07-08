# chat.yah.mobi 開発チーム/担当AIへの連携指示書

この指示書は、`yah.mobi`（本体）のFirebaseネイティブ化に伴う、`chat.yah.mobi` 側のアーキテクチャ・データ構造のアップデート要求事項です。
仕様書（v2.1）からの差分として、以下の内容をシステムプロンプトやバックエンド（Cloud Functions）の実装に反映してください。

---

## 1. 【最重要】同期処理（WebhookSync）の廃止と直接参照への変更
yah.mobi 本体が MySQL を経由せず、直接 Firebase をメインデータベースとして稼働する構成に変更されました。
そのため、移行過渡期として想定されていた `webhookSync` エンドポイントは **実装不要（廃止）** となります。

今後は、AI（`onVisitorMessageCreated` 関数）のコンテキスト構築において、yah.mobi 本体が直接書き込んでいる以下のネイティブコレクションを直接 `getDocs` / `query` して参照してください。

| 旧想定（仕様書v2.1） | 変更後（ネイティブ参照先） | 備考 |
| :--- | :--- | :--- |
| `/customerProfiles/{uid}` | **`/users/{uid}`** | Firebase Auth UID がドキュメントID |
| `/purchases/{externalOrderId}` | **`/orders/{orderId}`** | `userId` フィールドで顧客紐付け |
| `/esimStatuses/{externalOrderId}`| **`/esim_links/{linkUuid}`** | `orderId` および `userId` で紐付け |

---

## 2. AIシステムプロンプト（コンテキスト）への追加注入データ
`users` および `orders` コレクションから取得した以下のデータを、Gemini のシステムプロンプト（顧客コンテキスト）に追加で注入してください。

### A. VIP対応のための LTV データ
* **参照先**: `users/{uid}.metrics.ltvJpy` および `users/{uid}.metrics.orderCount`
* **AIへの指示例**: 「この顧客は LTV が X円（購入回数 Y回）のVIP顧客です。ホスピタリティ基準に従い、リピートへの感謝をトーンに含めてください。」

### B. 即時トラブルシューティングのための端末情報
* **参照先**: `users/{uid}.device.deviceModel` および `users/{uid}.device.os`
* **AIへの指示例**: 「顧客は {deviceModel} (OS: {os}) を使用しています。トラブルシューティング手順を案内する際は、この機種特有のメニュー名（例: iOSなら「モバイル通信」）を直接指定して回答してください。」

---

## 3. 「新規」と「追加チャージ（Top-up）」のAI切り分け
eSIMのトラブルシューティングにおいて、購入したものが「新規eSIM」か「既存eSIMへのデータ追加（Top-up）」かで案内すべき内容が全く異なります。

* **参照先**: `orders/{orderId}.orderType` (`"initial"` または `"topup"`)
* **AIへの指示例**:
  * 直近の注文が `orderType: "initial"` の場合: eSIM自体のインストールやアクティベート手順を案内してください。
  * 直近の注文が `orderType: "topup"` の場合: 既にインストール済みのeSIMにデータが追加される仕様です。QRコードの再読み込みは不要であることを伝え、端末の再起動や機内モードのオンオフを案内してください。

---

## 4. プロバイダ通信障害（宙吊りエラー）の自動共有
本体側では決済直後の eSIM プロバイダ（Bappy）通信エラーに対する自動リトライジョブ（`esim_retry_jobs`）が動くようになりました。

* **実装要求**: 顧客から問い合わせがあった際、直近の `order` に対応する `esim_retry_jobs` コレクション（未処理状態）が存在しないかチェックしてください。
* **AIへの指示例**: 「もし対象の注文がリトライジョブに入っている場合、『現在、通信プロバイダ側でシステム遅延が発生しており、お客様のeSIM設定はシステムが自動で再試行中です。数分以内にお届けできる見込みです』と案内し、クレーム化を防いでください。」
