# 設計図：金銭パスの防御強化（2026-07-19 レビュー残の実装）

対象: `dev` ／ ステータス: ユーザー指示済み（「他のも丁寧に進めて」）

## 実装項目

1. **Stripe イベントの in-flight 排他**（webhooks.ts）— 既存のクレームは「処理完了」しか見ず、処理中の並行配信が二重実行になる。`claimedAt` を追加し、未完了かつ 120 秒以内のクレームは 500 応答（Stripe が後で再送→その時点で processed 判定）。クラッシュはクレーム失効で自然回復。
2. **checkout.session.expired ハンドラ**＋**pending 自動失効** — 失効イベントで注文を `cancelled` へ。補完として hungOrderMonitor に「pending が 24h 超過→cancelled」を追加（旧 Timestamp 型 createdAt も正規化して判定＝7/6 の残骸 3 件もこれで消える）。
3. **注文未発見時は throw**（checkout.completed / charge.refunded）— 旧実装は return で processed:true になり Stripe 再送による回復が永久不能だった。checkout 側は metadata.order_id での getOrderById フォールバックも追加。
4. **部分返金ガード** — `charge.amount_refunded < charge.amount` の場合は refunded 確定・全額返金メールを送らず、`partialRefundedJpy` 記録＋オーナー通知に留める。
5. **topup 冪等ガード** — esim_activations に `orderId` を記録し、fulfillEsim の topup 前に既付与を照会（従来は topup 注文にガードが効かず再実行で二重付与）。
6. **リトライ経路の esim_links 完全化** — 本流と同じフィールド（status:active・expiryDate・qrCodeUrl・残量・plan join）で作成（従来は provisioning のまま QR 欠落）。
7. **orderRetryPayment の失効チェック** — sessions.retrieve で `status==="open"` を確認してから再利用、失効なら新セッション発行。
8. **hungOrderMonitor 実効化** — 監視対象を実在する `paid` / `pending_retry`（30分停滞）に変更＋2の pending 失効を統合。
9. **forge 通知チャネル復旧** — notify.ts に llm.ts と同じ既定URL（forge.manus.im）フォールバック（キーは既にバインド済み・URLだけ未設定で恒久死していた）。
10. **onUserCreated の匿名スキップ** — chat の匿名訪問者が eSIM 側 users にゴミ doc を作るのを防止（email 無し＋providerData 空はスキップ。region 移動は削除再作成を伴うため見送り）。
11. **nodemailer 6→9**（High 脆弱性8件）— API 互換（createTransport/sendMail）。デプロイ後に問い合わせフォームで実送信確認。
12. **静的ガイドの日次再ビルド** — CI に schedule＋workflow_dispatch を追加（価格焼き込みの陳腐化対策）。
13. 小物: OrderDetailPage/TopupPage の依存配列補完、zh-TW の死にキー deviceCheck.* 削除。

## 見送り（理由付き）
- OrderDetailPage:166 の自動同期 effect の依存補完 — 同期発火のタイミング挙動が変わり 60 秒レート制限ルールと相互作用するため、実機確認とセットで別途。
- onUserCreated の region/v2 移行 — 関数の削除・再作成を伴う。
- eSIMAccess webhook トークンのヘッダ移行 — eSIMAccess コンソール側の URL 変更と要協調。

## 検証
tsc / eslint / functions テスト（新規: 部分返金・topup冪等・in-flight・expired）/ client テスト / rules テスト。デプロイは functions＋hosting（client 小修正あり）。
