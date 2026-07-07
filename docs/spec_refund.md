# 実装仕様書：返金機能（ミニマル版）

対象ブランチ: `dev` ／ 作成: 2026-07-07 ／ ステータス: **仕様（要承認→実装）**
方針の詳細: [design_refund_strategy.md](./design_refund_strategy.md)（3レーンモデル）／ 本書は**実装に落とす最小仕様**。

## 0. 目的・スコープ（ミニマル）
- **課金済みなのに提供できていない**注文を、安全・冪等に返金し、**顧客・管理画面・DB**に正しく反映する。
- **最小構成**：Stripeを**返金の真実源**とし、①Webhook同期 ②**当社側エラーは自動返金（Lane A）** ③管理画面から手動実行（Lane B） ④顧客表示、を作る。
- **自動化の対象（Lane A）**：**当社/プロバイダ側の事由**（システムエラー・OMAX通信エラー等）で発行/topupが**最終失敗**した課金済み注文は、**自動で全額返金**する。
- **今回やらないこと（ミニマル維持）**：グレーゾーン/顧客都合の**自動**返金（＝Lane Bで手動）／部分返金／eSIMAccess の cancel 連携（柱2後）／問い合わせと注文の自動紐付け。

---

## 1. 全体アーキテクチャ（Stripe＝真実源）
```
返金トリガー（下記いずれか）
  ├ Lane A 自動：発行/topup 最終失敗（当社側エラー） → executeRefund("system_failure") ┐
  ├ Lane B 手動：管理画面「返金」タブの承認ボタン → adminRefundOrder(callable)          ├→ Stripe が返金実行
  └ Stripe ダッシュボードで手動返金                                                      ┘        │
                                                                                                  ▼
                                            Stripe Webhook: charge.refunded
                                                                         │
                        ┌────────────────────────────────────────────────┘
                        ▼  ここで初めて“確定”（単一の真実源・冪等）
   orders/{id}: status="refunded", refundStatus, stripeRefundId, refundedAt
   notifications: refund_completed（顧客in-app）
   mailer: 返金完了メール（顧客）
```
→ **どの経路で返金しても、Firestore反映・顧客通知は必ず Webhook 側で一元化**。

---

## 2. データモデル（`FsOrder` に4項目追加・後方互換）
```ts
refundStatus?: "none" | "processing" | "refunded" | "failed" | null;
stripeRefundId?: string | null;
refundReason?: string | null;   // "system_failure" | "manual" 等
refundedAt?: number | null;     // epoch ms
```
- 返金完了で `status` は既存の `"refunded"` に遷移。

---

## 3. バックエンド（functions）

### 3.1 `stripeWebhook` に `charge.refunded` ハンドラ追加（**心臓部**）
`functions/src/webhooks.ts`
- 既存の署名検証＋`stripe_events` 冪等ガードを流用。
- `ev.type === "charge.refunded"`（or `refund.updated`）で：
  1. `payment_intent` から対象 `order` を特定（`stripePaymentIntentId` で検索）。
  2. 既に `refunded` なら何もしない（冪等）。
  3. `updateOrder(id, { status:"refunded", refundStatus:"refunded", stripeRefundId, refundedAt: now })`。
  4. `createNotification({ type:"refund_completed", userId, orderId, ... })`。
  5. 顧客へ返金メール送信（失敗は catch してログ）。

### 3.2 `refund.ts`（返金実行の共通部品）
`functions/src/refund.ts`（新規）
```ts
export async function executeRefund(orderId, reason): Promise<{ ok: boolean }>
```
- 対象注文が返金可能か検証：`status ∈ {paid, failed}` かつ `refundStatus ∉ {refunded, processing}` かつ `stripePaymentIntentId` あり。
- `refundStatus="processing"` に更新（多重防止）。
- `stripe.refunds.create({ payment_intent, reason:"requested_by_customer" }, { idempotencyKey: "refund_"+orderId })`（全額）。
- 実際の `status="refunded"`＋通知は **§3.1 Webhook** に委譲（executeRefund はトリガーのみ）。
- Stripe API 失敗時：`refundStatus="failed"`＋`notifyOwner`。

### 3.3 Lane A 自動返金（当社側エラー）— **自動化の心臓部**
`functions/src/esimRetryService.ts`（最終失敗ブロック [L259-318](../functions/src/esimRetryService.ts#L259)）
- トリガー：`attemptNum >= job.maxRetries` の**最終失敗**（発行=createLink／topup=addTopupPlan がリトライ尽きて失敗）。＝**課金済みだが提供不能＝当社/プロバイダ側事由**。
- 実装：`updateOrder(job.orderId, { status:"failed" })`（L266）の直後に **`executeRefund(job.orderId, "system_failure")` を自動呼び出し**。
- ガードレール（暴走・二重返金の防止）：
  1. **冪等**：`executeRefund` が `refundStatus` ＋ Stripe `idempotencyKey` で担保（§3.2）。
  2. **実課金のみ**：`stripePaymentIntentId` がある注文だけ。無料/未課金は対象外（executeRefund 内で検証）。
  3. **確定・通知は Webhook に一元化**：自動でも `status="refunded"`＋顧客通知は charge.refunded（§3.1）経由＝全経路統一。
  4. **キルスイッチ（即時・/admin）**：Firestore `system_config/refunds.autoRefundEnabled`（bool）を実行時に読取。`false` なら自動返金せず `notifyOwner`（手動へ）。**Secretではない**（Secretは再デプロイが必要で緊急停止に不向き）＝ **/admin のトグルでワンクリック即オンオフ**。既定はON扱い（ドキュメント無し＝有効）だが、**読取エラー時は fail-closed**（そのオーダーは自動せず手動通知＝glitchで誤返金しない）。
  5. **可視化**：自動返金の実行は必ず `notifyOwner` ＋ `incident_logs` に記録（solo運用で全件把握）。
  6. **失敗フォールバック**：Stripe API 失敗時は `refundStatus="failed"`＋`notifyOwner` で手動に落とす。
- 文言差し替え：最終失敗時の既存文言（オーナーへ「手動で返金」／ユーザーへ「返金をリクエストして」）を、**自動返金が成功した場合は「返金しました」**に切り替える（失敗時のみ従来の手動案内）。

### 3.4 `adminRefundOrder`（callable・管理画面用＝Lane B）
`functions/src/callables.ts`
- `onCall({ enforceAppCheck:true })`＋**admin claims 必須**（非adminは `permission-denied`）。
- 入力：`{ orderId: string, reason?: string }`（zod）。
- `executeRefund(orderId, reason ?? "manual")` を呼ぶだけ。

### 3.5 通知・メール（5言語・購入時ページ言語で判定）
- 通知型 `refund_completed`（既存）を使用。
- `mailer.ts` に `buildRefundCompletedEmail({ orderId, amountJpy, language })` 追加（既存ビルダーと同型・黒ヘッダ／**緑（成功）ボックス**／CTA→/mypage／フッタ）。
- **言語判定＝`order.language`（購入時のページ言語）**。5言語（en/ko/zh-CN/zh-TW/th）分の文面を持ち、`order.language` で分岐。未設定/未知は **en フォールバック**。
- 英語文面（他4言語は同義訳。§10で全訳を確定）：
  - Subject: `[yah.mobile] Your refund has been processed — Order #{orderId}`
  - Title: `Your refund has been processed`
  - Body: `We're sorry — we were unable to deliver your eSIM for this order, so we have issued a full refund. You have not been charged for this order.`
  - Box（緑）: `Order #{orderId}` / `Refunded ¥{amount} to your original payment method`
  - Note: `The refund has been sent to the card or payment method you used at checkout. It typically takes 5–10 business days to appear on your statement, depending on your card issuer or bank.`
  - CTA（→ https://yah.mobi/mypage ）: `View your orders`
  - Footer: `This is an automated message from yah.mobile. If you have any questions, please contact us via our support page.`

#### 全訳（5言語・確定）
`{orderId}` / `{amount}` はプレースホルダ。CTA遷移先は全言語 `https://yah.mobi/mypage`。

**en（英語）** — 上記のとおり。

**ko（한국어）**
- Subject: `[yah.mobile] 환불이 완료되었습니다 — 주문 #{orderId}`
- Title: `환불이 완료되었습니다`
- Body: `죄송합니다. 이번 주문의 eSIM을 제공해 드리지 못하여 전액 환불해 드렸습니다. 이 주문에 대한 요금은 청구되지 않습니다.`
- Box: `주문 #{orderId}` / `결제하신 원래 결제 수단으로 ¥{amount} 환불`
- Note: `환불금은 결제 시 사용하신 카드 또는 결제 수단으로 전송되었습니다. 카드사 또는 은행에 따라 명세서에 반영되기까지 보통 5~10 영업일이 걸립니다.`
- CTA: `주문 내역 보기`
- Footer: `이 메일은 yah.mobile에서 자동으로 발송되었습니다. 문의 사항이 있으시면 지원 페이지를 통해 연락해 주세요.`

**zh-CN（简体中文）**
- Subject: `[yah.mobile] 您的退款已处理 — 订单 #{orderId}`
- Title: `您的退款已处理`
- Body: `非常抱歉，我们无法为此订单提供 eSIM，因此已为您全额退款。此订单不会向您收取任何费用。`
- Box: `订单 #{orderId}` / `已将 ¥{amount} 退回至您的原支付方式`
- Note: `退款已退回至您结账时使用的银行卡或支付方式。视发卡行或银行而定，通常需要 5–10 个工作日才会显示在您的账单中。`
- CTA: `查看您的订单`
- Footer: `这是来自 yah.mobile 的自动发送邮件。如有任何疑问，请通过我们的支持页面与我们联系。`

**zh-TW（繁體中文）**
- Subject: `[yah.mobile] 您的退款已處理 — 訂單 #{orderId}`
- Title: `您的退款已處理`
- Body: `非常抱歉，我們無法為此訂單提供 eSIM，因此已為您全額退款。此訂單不會向您收取任何費用。`
- Box: `訂單 #{orderId}` / `已將 ¥{amount} 退回至您的原付款方式`
- Note: `退款已退回至您結帳時使用的信用卡或付款方式。視發卡機構或銀行而定，通常需要 5–10 個工作天才會顯示在您的帳單中。`
- CTA: `查看您的訂單`
- Footer: `這是來自 yah.mobile 的自動發送郵件。如有任何疑問，請透過我們的支援頁面與我們聯絡。`

**th（ไทย）**
- Subject: `[yah.mobile] คืนเงินให้คุณเรียบร้อยแล้ว — คำสั่งซื้อ #{orderId}`
- Title: `คืนเงินให้คุณเรียบร้อยแล้ว`
- Body: `ขออภัยเป็นอย่างยิ่ง เราไม่สามารถจัดส่ง eSIM สำหรับคำสั่งซื้อนี้ได้ จึงได้คืนเงินเต็มจำนวนให้คุณแล้ว คุณจะไม่ถูกเรียกเก็บเงินสำหรับคำสั่งซื้อนี้`
- Box: `คำสั่งซื้อ #{orderId}` / `คืนเงิน ¥{amount} ไปยังวิธีการชำระเงินเดิมของคุณ`
- Note: `เงินคืนถูกส่งไปยังบัตรหรือวิธีการชำระเงินที่คุณใช้ตอนชำระเงิน โดยปกติจะใช้เวลาประมาณ 5–10 วันทำการจึงจะปรากฏในใบแจ้งยอดของคุณ ทั้งนี้ขึ้นอยู่กับผู้ออกบัตรหรือธนาคารของคุณ`
- CTA: `ดูคำสั่งซื้อของคุณ`
- Footer: `อีเมลนี้เป็นข้อความอัตโนมัติจาก yah.mobile หากคุณมีคำถามใดๆ โปรดติดต่อเราผ่านหน้าฝ่ายสนับสนุน`

### 3.6 購入時ページ言語を注文に保存（メール多言語化の基盤）
- **背景**：現状 `orders` に言語が無く（`FsOrder` に未定義）、既存トランザクションメールは日本語ハードコード。返金メールの言語判定のため、購入時のUI言語を注文に載せる。
- 変更（いずれも小）：
  1. `shared/types.ts`：`FsOrder` に `language?: string | null` 追加。
  2. `shared/schemas.ts`：`OrdersInitCheckoutInput` / `OrdersInitTopupCheckoutInput` に `language: z.string().nullish()` 追加。
  3. クライアント：`usePurchaseCheckout.ts` / `TopupPage.tsx` の決済呼び出しで `language: i18n.language` を送信。
  4. `functions/src/callables.ts`：`ordersInitCheckout` / `ordersInitTopupCheckout` で order に `language` を保存。
- **副次効果**：この `order.language` は将来 発行完了/遅延/失敗メールの多言語化にも再利用可能（今回は返金メールのみ利用）。

---

## 4. 管理画面：`/admin` 返金（Refunds）タブ
- `AdminPage.tsx` の `TABS`/`VALID_TABS` に `refunds` 追加＋`RefundsTab.tsx` 新規。
- **一覧（返金候補）**：`orders` をクライアント購読（admin read 可＝ルール確認済み）。
  - 表示対象：`status=="failed"` を既定表示。**Lane A で自動返金済みは `refundStatus=="refunded"` バッジ**が付くので一目で区別でき、**`refundStatus` が `failed`/`none` の残り（＝自動返金が通らなかった・グレーゾーン）だけが手動対象**。全注文検索も可。
  - 各行：注文ID・金額・作成日・失敗理由・`refundStatus` バッジ。
- **承認ボタン**：「返金する」→ 確認ダイアログ（金額・理由）→ `adminRefundOrder`。実行中はボタン無効化。
- **自動返金トグル（キルスイッチ）**：タブ上部に「自動返金 ON/OFF」トグル。`system_config/refunds.autoRefundEnabled` を読み書き（現在値を表示、ワンクリックで即切替＝再デプロイ不要）。障害時の緊急停止用。
- ＝ **返金の判断・実行・自動停止が1タブに集約**（solo運用向け）。

> Lane B（グレーゾーン）：お客様は既存の**問い合わせフォーム**で「返金希望」を送信 → 管理者が返金タブで該当注文を検索して承認、で運用（自動紐付けは今回スコープ外）。

---

## 5. 顧客画面：注文カードに返金表示（**採用＝Option B**）
- MyPage の**注文カード**（`OrderList.tsx` / `ActiveEsimSummary.tsx`）に：
  - `status=="refunded"` のとき **「Refunded」バッジ**＋`Refunded ¥{amount} · {refundedAt}` を1行表示。
- **新規メニュー/ルートは作らない**（ミニマル）。返金時の**通知＋メール**が能動的告知、カードが恒久記録。
- 文言は i18n（5言語）に `mypage.refunded` 等を追加。

---

## 6. セキュリティ / rules
- `adminRefundOrder`：App Check＋admin claims 必須。
- `orders` の `refundStatus`/`status` はクライアント書込不可（既存 orders ルールで担保済み＝Cloud Functions専用）。追加フィールドも同ルール下。
- 返金候補一覧は admin read（`isAdmin()`）で既に可。
- **`system_config/refunds`（キルスイッチ）**：`allow read, write: if isAdmin()`（顧客は読取不可）。関数側は admin SDK で読取（ルール素通り）。＝ `firestore.rules` に1コレクション追加（**要承認**）。

---

## 7. 法務（Terms/llms.txt）
方針：「デジタル商品につき原則返金不可。ただし**当社側の技術的理由で提供できない場合は全額返金**（当社検知の失敗は自動）」を明記。現行文面は「当社側の技術的問題なら**サポートに連絡**」止まりで**返金を明言していない**ため、下記に差し替える。Terms.tsx は英語ハードコード（多言語化しない既存踏襲）。**Terms.tsx＝クライアント、llmsTxt.ts＝functions/src（要承認）**。

### 7.1 `Terms.tsx` §4 Refund Policy（差し替え文）
> eSIM is a digital product. Once your QR code has been issued, cancellations and refunds are not available. **Exception:** if we are unable to deliver your eSIM or data top-up due to a technical problem on our side (for example, a system error or a failure of our upstream provider), we will refund your payment in full. In such cases the refund is issued **automatically** to your original payment method once the failure is confirmed, and no action is required on your part. If your eSIM was delivered but you experience technical issues preventing activation, please contact our support team within 24 hours of purchase.

### 7.2 `Terms.tsx` §10 特商法「Returns/Cancellations」節（差し替え文）
> Returns/Cancellations: Not accepted after QR code issuance (digital product). **Exception:** if we cannot deliver the eSIM or top-up due to a technical issue on our side (a system error or an upstream provider failure), the payment is refunded in full — issued automatically to the original payment method once the failure is confirmed. For activation issues after delivery, contact support within 24 hours of purchase.

### 7.3 `functions/src/llmsTxt.ts`（2箇所・差し替え文）
- **Refund policy 行（現 L82）**：
  > **Refund policy**: eSIM is a digital product. Once payment is completed, cancellations and refunds are not available, **except where we are unable to deliver the eSIM or top-up due to a technical problem on our side (a system error or an upstream provider failure) — in that case the payment is refunded in full, automatically, to the original payment method.** Customers confirm this policy via a checkbox before completing purchase.
- **FAQ「Is there a refund policy?」（現 L126-127）**：末尾に例外文を追加：
  > The only exception is when we are unable to deliver your eSIM or top-up due to a technical problem on our side — in that case we refund your payment in full, automatically, to your original payment method.

---

## 8. 検証計画
1. **Stripe テストモード**：テストカードで購入 → ダッシュボード手動返金 → Webhookで `refunded`＋通知＋メールを確認（§3.1が単体で機能）。
2. **Lane A 自動**：発行を強制失敗させ（テスト）、最終失敗で `executeRefund` が自動起動 → Stripe返金 → Webhookで `refunded`＋通知を確認。`AUTO_REFUND_ENABLED=false` で自動返金が止まることも確認。
3. 管理画面「返金」タブのボタン → `adminRefundOrder` → 上記フローが走ることを確認。
4. **冪等**：同一注文の二重返金が起きない（idempotencyKey＋refundStatus＋Webhook冪等）。Lane A自動とLane B手動が同一注文で衝突しても二重返金しない。
5. **言語**：`order.language`（購入時ページ言語）で返金メールが5言語分岐する／未設定は en フォールバックを確認。
6. functions build/test・rules テスト（`adminRefundOrder` の admin限定）・client tsc/test・E2E。
7. `dev` コミット → 本番 functions デプロイ・実返金はユーザー指示で。

---

## 9. 実装フェーズ（最小・この順）
- **F0（前提・小）**：購入時ページ言語を注文に保存（§3.6）。返金メール5言語判定の基盤。F1と並行/先行可。
- **F1（土台）**：`FsOrder`4項目 ＋ `stripeWebhook` に `charge.refunded` 同期 ＋ 返金メール/通知。→ **これだけで「Stripe手動返金がアプリに反映＆顧客通知」完成**。
- **F2（実行部品）**：`refund.ts`（`executeRefund`）＋ キルスイッチ（`system_config/refunds.autoRefundEnabled` 読取）。
- **F3（Lane A 自動）**：`esimRetryService` 最終失敗フックから `executeRefund("system_failure")` を自動呼び出し（§3.3）。→ **当社側エラーは自動返金**。
- **F4（Lane B 手動）**：`adminRefundOrder` ＋ `/admin` 返金タブ（承認ボタン）。→ **グレーゾーン/自動失敗分を手動返金**。
- **F5（顧客表示）**：注文カードの Refunded バッジ（i18n 5言語）。
- **F6（法務）**：Terms/llms.txt の例外条項。
- （将来）eSIMAccess cancel 連携は柱2で。

## 10. 要決定（実装前）
- [x] **Lane A（当社側エラー）は自動全額返金**とする（`esimRetryService` 最終失敗フック）。＝本更新で確定。
- [x] **キルスイッチ＝Firestore `system_config/refunds.autoRefundEnabled` ＋ /admin トグル**（Secret不採用＝再デプロイ不要で即停止）。本更新で確定。
- [x] **Lane A の自動返金対象＝発行失敗＋topup失敗の両方**（どちらも当社側事由）。本更新で確定。返金対象は失敗した当該注文（`esimRetryService` の `job.orderId`。topup時はtopup注文の金額を全額返金）。
- [x] **返金メール＝5言語・`order.language`（購入時ページ言語）で判定**（未設定は en フォールバック）。購入時に言語を注文へ保存（§3.6）。本更新で確定。
- [x] **返金メール文面＝5言語すべて確定**（en/ko/zh-CN/zh-TW/th、§3.5 全訳）。本更新で確定。
- [x] **Terms/llms.txt 例外条項の文面＝確定**（§7.1〜7.3・英語）。本更新で確定。
