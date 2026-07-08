# ランブック：eSIMAccess 本番切替（柱2 デプロイ／有効化）

対象: `dev`→本番（`main`）／作成: 2026-07-08 ／前提: 柱2バックエンド実装完了（dev push済 aea9825）。functions 65 tests / client build green。

> 🚨 **本番 functions デプロイ・本番プラン活性化は、実施者（あなた）の操作で行う。** 各ステップはコマンド付き。値（シークレット）はシェル履歴・チャットに残さない。
> ⚠️ dev チャンネルも **バックエンド（Functions/Firestore/Auth）は本番共有**。dev での購入は本番データ・本課金・本eSIM発行になる。

---

## 全体の流れ
```
0. 前提確認  →  1. reauth  →  2. シークレット3つ bind  →  3. functions デプロイ
→ 4. Webhook URL 登録(eSIMAccess)  →  5. 12プラン活性化＋JPY価格＋Bappy停止
→ 6. dev で実発注E2E（1本買って発行→QR→返金で確認）→ 7. 本番判断
```

切替の安全性：デプロイしても **eSIMAccessプランは inactive のまま**なので、5で活性化するまで顧客影響ゼロ。Bappy販売は5で止めるまで従来どおり。

---

## 0. 前提確認（読み取りのみ）
```bash
cd ~/Downloads/yah-mobile-v4-dev_202607031209
export PATH="$HOME/node22/bin:$PATH"
git -C . branch --show-current            # dev であること
git -C . log --oneline -1                 # aea9825 以降
firebase projects:list | grep yah-mobile-v1-3ed24
```

## 1. Firebase 再認証（AIは不可・あなたのみ）
```bash
firebase login --reauth
```

## 2. シークレット3つを bind（対話入力＝履歴に残らない）
`ESIMACCESS_ACCESS_CODE` / `ESIMACCESS_SECRET_KEY` は Postman/ダッシュボードの値。
`ESIMACCESS_WEBHOOK_TOKEN` は**この場で生成する推測不能トークン**（後で eSIMAccess のURLにも使う）。
```bash
cd ~/Downloads/yah-mobile-v4-dev_202607031209/functions

# 生成（この値を控える。手順4で使う）
openssl rand -hex 24        # 例: 3f9c...（48桁hex）→ メモ

# それぞれ実行するとプロンプトが出るので値を貼る（画面に出るが履歴には残らない）
firebase functions:secrets:set ESIMACCESS_ACCESS_CODE
firebase functions:secrets:set ESIMACCESS_SECRET_KEY
firebase functions:secrets:set ESIMACCESS_WEBHOOK_TOKEN   # ↑で生成した値を貼る
```
確認（値は表示されない）:
```bash
firebase functions:secrets:access ESIMACCESS_ACCESS_CODE >/dev/null 2>&1 && echo "ACCESS_CODE OK"
firebase functions:secrets:access ESIMACCESS_SECRET_KEY  >/dev/null 2>&1 && echo "SECRET_KEY OK"
firebase functions:secrets:access ESIMACCESS_WEBHOOK_TOKEN >/dev/null 2>&1 && echo "WEBHOOK_TOKEN OK"
```

## 3. functions を本番へデプロイ（🚨本番）
```bash
cd ~/Downloads/yah-mobile-v4-dev_202607031209/functions
npm run build                       # tsc（エラー0を確認）
cd ~/Downloads/yah-mobile-v4-dev_202607031209
firebase deploy --only functions
```
- 完了ログに `esimaccessWebhook` のURLが出る（例 `https://esimaccesswebhook-xxxx-an.a.run.app` か `https://asia-northeast1-yah-mobile-v1-3ed24.cloudfunctions.net/esimaccessWebhook`）。**このURLを控える。**
- 影響：`providerHealthCheck` が eSIMAccess残高pingに切替（15分毎）。この時点では販売プランは未変更＝顧客影響なし。
- 動作確認（任意）：数分後、Firestore の `system_config/provider_health` に `esimaccess.status:"ok"` と `balanceUsd` が入っていれば署名・疎通OK。

## 4. eSIMAccess に Webhook URL を登録（秘密トークン付き）
eSIMAccess ダッシュボード（または `/webhook/save`）で、登録URLを**トークン付き**にする：
```
<手順3のURL>?token=<手順2で生成した ESIMACCESS_WEBHOOK_TOKEN>
```
- 登録直後に `CHECK_HEALTH` が飛び、当方は 200 を返す（正常）。
- トークン不一致は 403。IPは公式5IPを許可リストで監視（不一致はオーナー通知）。

## 5. プラン活性化＋JPY価格設定＋Bappy停止（/admin PlansTab）
`/admin` にログイン → Plans タブ。**Provider=esimaccess** の12件が見える。
1. **各ベース6件**に `Price(¥)` を設定（Wholesale($)＝卸・Margin列を見て決める）。目安：
   | プラン | 卸USD | 参考(¥120/$時の原価) |
   |---|---|---|
   | 1GB/7d | $0.70 | ≈¥84 |
   | 3GB/15d | $1.70 | ≈¥204 |
   | 5GB/30d | $2.70 | ≈¥324 |
   | 10GB/30d | $4.70 | ≈¥564 |
   | 20GB/30d | $8.20 | ≈¥984 |
   | 50GB/30d | $17.00 | ≈¥2,040 |
   ※小売JPYは自社マージンで決定。Margin列が黒字（緑）になる値に。
2. **topup 6件**も同様に価格設定（不要なら inactive のまま）。
3. 価格を入れたら各行 **Active** に切替。
4. **現行のBappyプラン（Provider=bappy）を Inactive** に切替（＝Bappy販売停止／eSIMへ一気切替）。
   - 既存Bappy eSIMの同期は継続（休眠コードは残置）。

## 6. dev チャンネルで実発注E2E（launch-eve 検証）
> dev URL: https://yah-mobile-v1-3ed24--dev-tvnc2fob.web.app
> 事前：dev URL が reCAPTCHA Enterprise の許可ドメインに入っていること（App Check）。
1. 最小プラン（1GB）を**実購入**（Stripe本課金）。
2. 確認：
   - 数十秒で **eSIM発行**（`ORDER_STATUS(GOT_RESOURCE)`→`/esim/query`でICCID/QR）。
   - MyPageに **QR/インストール** 表示、ステータス、期限。
   - `esim_links` に `provider:"esimaccess"` / `providerRef(esimTranNo)` / iccid / lpaProfile。
3. **返金で検証**：/admin 返金タブ or Stripeで返金 → 未有効化なら `cancel`（残高返金）→ `charge.refunded` で order refunded＋返金メール。
   - `system_config/provider_health.esimaccess.balanceUsd` が cancel分ちょい戻ることも確認可。
4. （任意）topup：残量を使う端末があれば topup も。無ければ後日。

## 7. 本番リリース判断
- dev E2E がOKなら、必要に応じ `dev`→`main` マージ → `firebase deploy --only hosting`（**ユーザー明示指示で**）。
- functions は手順3で既に本番反映済み（hostingとは別）。プラン活性化(手順5)で販売が eSIMAccess に切替わる。

---

## ロールバック
- **即時販売停止**：`system_config/provider_health` に `{esimaccess:{status:"down"}}` を手動セット → 購入callableが弾く（課金しない）。または PlansTab で eSIMAccessプランを Inactive。
- **Bappy暫定復帰**：Bappyプランを `isActive:true` に戻す（休眠コードは生きている）。
- in-flight失敗は自動返金（Lane A）。

## 監視ポイント（切替後）
- `system_config/provider_health.esimaccess`：`status`／`balanceUsd`（低残高<$20はオーナー警告）。
- `esimaccess_webhook_events`：notifyId 冪等ログ。
- `incident_logs` / オーナー通知（Forge/Slack/メール S9）。
