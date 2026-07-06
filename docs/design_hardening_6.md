# 設計図：堅牢化 6件（Rules検証 / LLM出力制限 / 同期時刻 / 宙吊り注文 / Bappy障害通知 / 自動返金）

作成日: 2026-07-06 / 対象ブランチ: `dev`

> 全件 実コードで妥当性確認済み。**すべて `firestore.rules` / `functions/` / Stripe に関わるため、各グループ着手時に本設計の承認を得てから実装**（CLAUDE.md）。本番反映（hosting/functions デプロイ）は別途ユーザー明示指示。

推奨順：**第1G（③⑤④）→ 第2G（①②）→ ⑥（単独・要特別注意）**

---

## ③ syncRequestedAt をサーバ時刻に（機能バグ・クライアントのみ）

**現状**：`OrderDetailPage.tsx` の「Refresh data usage」が `syncRequestedAt: Date.now()`（number）を書く。一方 **Rules は既に `syncRequestedAt == request.time`・`updatedAt == request.time`（Timestamp）を要求**（`firestore.rules:101-102`、レート制限は `resource.data.syncRequestedAt.toMillis()`）。
→ **number ≠ Timestamp でルールに弾かれ、同期ボタンが実質失敗している疑い**（指摘は妥当。ただし**Rules は既に正しく、直すのはクライアントのみ**＝指摘の「Rules も統一」は不要）。

**変更**：`client/src/pages/OrderDetailPage.tsx` の該当 `updateDoc` を
```ts
import { serverTimestamp } from "firebase/firestore";
await updateDoc(doc(getFirebaseDb(), "esim_links", esimLink.id), {
  syncRequestedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});
```
- `serverTimestamp()` は Rules 上 `== request.time` と評価されるため、書き込みが通る（＝同期ボタンが機能）。
- **rules/functions 変更なし**（クライアントのみ）。リスク小。
- 検証：dev で「Refresh data usage」→ 拒否されず `syncRequestedAt` が入る／60秒レート制限が効く。

## ⑤ Bappy webhook 障害のオーナー通知（functions）

**現状**：`functions/src/webhooks_bappy.ts:105-107` は `catch` で `logger.error` のみ・通知なし。`esim_installed` 等の処理失敗がログを見ないと気づけない。

**変更**：catch に `notifyOwner()`（既存 `./adapters/notify`、`esimRetryService` で使用実績）を追加。`bappyWebhook` 関数の `secrets` に `BUILT_IN_FORGE_API_KEY` / `SLACK_WEBHOOK_URL` を追加（`scheduled.ts` と同じ defineSecret）。
```ts
} catch (err) {
  logger.error(`[bappyWebhook] Error ... ${bappyLinkUuid}:`, err);
  try { await notifyOwner({ title: "Bappy Webhook 処理失敗", content: `link=${bappyLinkUuid} event=${eventType}: ${String(err)}` }); } catch {}
  res.status(500).send("Internal server error");
}
```
- ※ **Bappy の“認証”は OMAX 担当で不可侵**。本件は「当方の処理失敗の通知」でありその範囲外。
- functions 変更 → 承認要。検証：dev で意図的に失敗させ通知到達（or ユニットで notifyOwner 呼び出し確認）。

## ④ 宙吊り注文（provisioning放置）の検出（functions・最大リスク）

**現状**：`scheduled.ts` の `esimRetryJob` は**既存のリトライ“ジョブ”**を処理するのみ。Webhook がタイムアウト等でリトライジョブ作成前に落ちると、`orders.status="provisioning"` のまま**誰にも拾われない**。

**変更**：`functions/src/scheduled.ts` に新スケジュール関数を追加（`onSchedule("every 15 minutes")`）。
```ts
// orders where status=="provisioning" && updatedAt < now-30min を検出 → notifyOwner
export const hungOrderMonitor = onSchedule({ schedule: "every 15 minutes", region: "asia-northeast1",
  secrets: [forgeApiKey, slackWebhookUrl] }, async () => {
  const cutoff = Date.now() - 30*60*1000;
  const snap = await db.collection("orders").where("status","==","provisioning").where("updatedAt","<",cutoff).get();
  if (!snap.empty) await notifyOwner({ title: `宙吊り注文 ${snap.size}件`, content: snap.docs.map(d=>d.id).join(", ") });
});
```
- まずは**検出＋通知**（自動復旧は範囲外）。複合インデックス（status ASC, updatedAt ASC）が必要な場合は `firestore.indexes.json` に追加。
- functions 変更 → 承認要。検証：dev で provisioning の古い注文を用意し通知確認。

## ① plans 書き込みの Rules 検証（rules・要承認）

**現状**：`firestore.rules:64-66` `allow write: if isAdmin();` のみ。`priceJpy:-1` 等が書ける。PlansTab は `priceJpy`/`validityDays` を **int**、`isActive` を **bool**、`bappyPlanId`/`name` を **string** で書く（整合）。

**変更**：`create/update` に型・範囲検証を追加。**delete は request.resource が無い**ため分離（isAdminのみ）。
```
match /plans/{planId} {
  allow read: if true;
  allow delete: if isAdmin();
  allow create, update: if isAdmin()
    && request.resource.data.priceJpy is int && request.resource.data.priceJpy > 0 && request.resource.data.priceJpy < 100000
    && request.resource.data.validityDays is int && request.resource.data.validityDays > 0 && request.resource.data.validityDays <= 3650
    && request.resource.data.isActive is bool
    && request.resource.data.bappyPlanId is string && request.resource.data.name is string;
}
```
- rules 変更 → 承認要。**`tests/firestore.rules.test.ts` に正常/異常(価格0や負値, 文字列priceJpy等)のテストを追加**してから反映。Admin SDK 経由の移行は Rules をバイパスするので影響なし。

## ② LLM 出力の長さ制限（functions）

**現状**：`functions/src/callables.ts:140` `const insight = response.choices?.[0]?.message?.content ?? "…"`（slice無し）。※`summaryText` は**サーバ生成のプロンプト**なので対象外（指摘対象名を `insight` に訂正）。

**変更**：`const insight = (response.choices?.[0]?.message?.content ?? "…").slice(0, 5000);`
- functions 変更 → 承認要。リスク極小。検証：型チェック＋既存テスト。

## ⑥ 自動返金（Stripe・単独・要特別注意）

**現状**：`esimRetryService.ts:289` は最終失敗時に「手動返金してください」メール文言のみ。`stripe.refunds.create` 無し。

**変更方針**：最終失敗（`MAX_RETRIES` 到達）時に自動返金。注文は `stripePaymentIntentId` を保持（確認済み）。
```ts
await stripe.refunds.create(
  { payment_intent: order.stripePaymentIntentId, reason: "requested_by_customer" },
  { idempotencyKey: `refund_${order.orderId}` }   // 二重返金防止
);
await updateOrder(order.orderId, { status: "refunded", updatedAt: Date.now() });
```
- **金銭処理のため安全策必須**：①冪等キー（order単位）で二重返金防止 ②`status==="refunded"` なら再実行しない ③`stripePaymentIntentId` 未設定はスキップ ④返金失敗時は `notifyOwner`＋手動フォールバック（現行メール維持）。
- functions＋Stripe → 承認要。**単独で慎重に**。検証：Stripe テスト環境 or 少額での確認手順を別途相談。

---

## 影響範囲・共通事項
- ③はクライアントのみ。①はrules。②④⑤⑥はfunctions。⑥はStripe。
- functions は共有デプロイ（本番）＝反映は別途ユーザー指示。rules 反映（`firebase deploy --only firestore:rules`）も同様。
- 各グループ：設計承認 → dev 実装 → 型チェック/テスト/（dev）確認 → dev コミット。

## 承認のお願い
まず**第1グループ（③→⑤→④）**から着手してよいですか？（③はクライアントのみで即効・低リスク、⑤⑥④は functions）。順序・範囲のご希望があれば調整します。⑥（自動返金）は最後に単独で。
