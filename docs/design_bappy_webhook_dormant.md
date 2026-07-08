# 決定書：柱1 bappyWebhook 認証 — 休眠受容（0.9-3）

対象: `functions/src/webhooks_bappy.ts`（`bappyWebhook`）
決定日: 2026-07-08 ／ 決定: **(B) 休眠を受容し、署名検証は現時点では追加しない**（明文化）

## 背景
- Bappy は**旧プロバイダ**。柱2で **eSIMAccess 単一プロバイダに移行済み**で、**新規販売はすべて eSIMAccess**（`provider:"esimaccess"`）。Bappy 経由の新規発行は発生しない＝**休眠**。
- コードに `// TODO: Verify Bappy signature here if/when provided`（[webhooks_bappy.ts:40](../functions/src/webhooks_bappy.ts#L40)）が残存。エンドポイントは未認証。
- CLAUDE.md 明記：**「Bappy Webhook 認証は OMAX 側が担当。こちらでは扱わない・変更しない」**。

## エンドポイントの実挙動（精査済み）
`bappyWebhook`（`onRequest`・asia-northeast1）が行うのは以下のみ：
- リクエスト body の `bappyLinkUuid` をキーに **`esim_links/{uuid}` を update**（`dataRemainingMb` / `installedDeviceModel` / `status`(active/expired) / `lastActiveAt`）。
- notable イベント時に `usage_logs` サブコレクションへ追記。

**財務・不可逆な操作は一切ない**（返金・課金・注文ステータス変更・プロビジョニング・メール送信を**含まない**）。

## 残存リスク評価（受容の根拠）
| 観点 | 評価 |
|---|---|
| 影響範囲 | **既存 Bappy eSIM の表示状態のみ**（残量/ステータス/最終利用）。`updateEsimLink` は `.doc(uuid).update()` で**存在するドキュメントにしか当たらない**（非存在は失敗）。 |
| 財務影響 | **なし**（返金/課金トリガーを持たない） |
| 攻撃の前提 | 有効な **`bappyLinkUuid`（ランダムUUID）を知っている**必要がある。列挙不可（非存在は update 失敗）。 |
| 対象の広がり | **休眠のため固定・縮小方向**（新規 Bappy 発行なし）。新規販売の eSIMAccess は別Webhook（`esimaccessWebhook`）で**トークン＋IP＋裏取りの多層防御済み**。 |
| 入力健全性 | 実装済み：未知 `eventType` は状態を書換えず無視／`dataRemainingMb` は 0〜1TB の有限数のみ／文字列は切詰。 |

→ **未認証だが、影響は「休眠中の旧eSIMの表示状態の改ざん（非財務）」に限定**され、有効UUIDの事前知得が前提。GA前の必須対応にはあたらない。認証の責務は OMAX 側（CLAUDE.md）。

## 決定
- **(B) 現時点では署名検証を追加しない（休眠受容）。** 上記の限定的残存リスクを受容する。
- 認証の責務は **OMAX 側**（CLAUDE.md 準拠）。こちらからは変更・デプロイしない。
- コード上の曖昧な `TODO` を、**この決定を指す注記に置換**（誤って「未対応の脆弱性」と読まれないように・挙動不変＝再デプロイ不要）。

## 将来の再ハードニング条件（バックログ）
Bappy を**再稼働**させる場合は、`esimaccessWebhook` と同じ **秘密トークンURL（`?token=`）＋送信元IP許可＋（可能なら）権威API裏取り**を最小コストで導入する（設計は eSIMAccess 版が雛形）。それまでは本決定を維持。

## 検証
- コード変更は**コメントのみ**（挙動不変）。`cd functions && npm run build` が通ること（型・ビルド）。**再デプロイ不要**。
