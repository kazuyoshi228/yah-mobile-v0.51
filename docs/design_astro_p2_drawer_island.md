# 設計図：Astro/GEO P2 — 購入ドロワーの島化（ガイド内で即ドロワー）

対象ブランチ: `feat/astro-migration` ／ 作成: 2026-07-15 ／ ステータス: **設計（要承認→実装）**
出典: `docs/design_astro_geo_p1.md` §5「P2: PurchaseDrawer 共有島化（openDrawer()グローバル化）＋ガイド内即ドロワー」。

## 1. 背景・目的
P1 では /esim ガイドの購入ボタンは `/app?open=true&plan=<docID>` への **deep-link**（1遷移でSPAのドロワーを開く）。P2 のゴールは、**ガイドから離れずその場で本物の PurchaseDrawer を開く**こと（遷移ゼロ＝CVRの摩擦をさらに削る）。

## 2. 現状（確認済み）
- **Provider ツリー**（`client/src/main.tsx`）: `QueryClientProvider > App`。加えて `import "./i18n"`（react-i18next 初期化）、errorReporting/umami/chatBridge を起動時に実行。
- **ドロワーの状態**（`client/src/pages/AppPage.tsx`）: `drawerOpen / drawerPlanId / drawerInitialStep / drawerInitialGb / drawerInitialDays / drawerOrderId` を AppPage が保持し、`?open=true&plan=…` を `AppPage.tsx:245` の `useEffect` が解釈して開く。
- **ドロワーの context**（`components/app/purchase-drawer/contexts/`）: `checkout.ts` / `flow.ts` / `session.ts` の3分割 ＋ `useCurrency` / `usePurchaseCheckout`。
- **i18n**: SPA本体は en/ko/zh-CN/zh-TW/th のみ（**ja ロケール無し**）。

## 3. アーキ判断（🔴 最重要）
**方式B：`<PurchaseDrawerIsland>` を新設し、必要 Provider だけを内包した"自己完結の島"としてガイドに載せる。**
- 島 = `QueryClientProvider ＋ i18n ＋ ドロワー3 context ＋ Currency ＋ Firebase(遅延)` でラップした **PurchaseDrawer のみ**（App/wouter 全体は載せない）。
- グローバル `window.__openPurchaseDrawer(planId, opts)` を島マウント時に公開。ガイドの購入ボタンは **プログレッシブ・エンハンスメント**：
  - 既定は今の `<a href="/app?open=true&plan=…">`（**no-JS/クローラ/失敗時のフォールバック＝deep-link**）。
  - JS有効時は click を横取り → 島を（初回のみ）動的import＆マウント → `__openPurchaseDrawer(planId)`。
- **却下案A（App丸ごと島化）**: wouter/全context/PWA まで載り重すぎ＝GEO軽量が崩れる。却下。
- **却下案C（P1のまま deep-link）**: それはP1。P2の目的（遷移ゼロ）を満たさない。

### ロード戦略（性能・GEO維持）
- **初回購入クリックで遅延マウント**（dynamic import）。ページ初期ロードに Firebase/Stripe/i18n を載せない → **GEO静的HTMLとLCPは無傷**、クローラは静的HTMLのまま。
- `client:idle` ではなく「クリック時マウント」を採るのは、モーダルは開くまで不要＝最小JSにするため。

## 4. 対象ファイルと変更方針
- **新規** `src-astro/islands/PurchaseDrawerIsland.tsx`（Reactエントリ）: Provider群 ＋ PurchaseDrawer ＋ 内部 open state ＋ `window.__openPurchaseDrawer` 公開。`client/src` のコンポーネントを alias(`@`) 経由で再利用。
- **新規/薄い** マウント用ヘルパ（Astro側の小さな `<script>` か island）: 初回クリックで island を import しコンテナへ `createRoot().render`。
- **改修** `src-astro/pages/esim/[lang]/[slug].astro`: 購入ボタンに `data-plan` を付与＋フォールバックhref維持。マウント用スクリプトを読み込む（`<script>` は Astro が束ねる）。
- **改修（最小・SPA側）**: PurchaseDrawer を App 文脈外でマウント可能にするため、**wouter 等 App依存があれば島内に最小 Router/shim を用意**（§6で精査）。SPA本体の挙動は不変に保つ。
- **無改修**: functions / firestore.rules / storage.rules / 既存SPAの購入フロー本体。

## 5. 開閉機構（deep-link と共存）
```
購入ボタン = <a href="/app?open=true&plan=PAK783GRS" data-plan="PAK783GRS">購入</a>
 ├─ JS無効/クローラ/島ロード失敗 → href の deep-link（P1どおり）
 └─ JS有効 → click横取り → (初回)島を動的import&mount → window.__openPurchaseDrawer("PAK783GRS")
```
- 完了/決済後の戻り先やエラー時も、島が無い場合は deep-link に自然フォールバック。

## 6. 重要な論点・リスク（要精査／要判断）
1. **wouter 依存**: PurchaseDrawer や Step*（例：Step3Login は `useLocation` 等）が App の Router context を使う場合、島内に最小の wouter `<Router>` を供給する必要。**実装ステップ1で依存を精査**し、必要なら shim。← 島化可否の最大リスク。
2. **ja i18n ギャップ**: SPAに ja が無いため、ガイドが ja でも**ドロワーは en（またはブラウザ言語）**表示になる。現状の deep-link も /app（非ja）に着地するので**悪化はしない**が、ja記事×英語ドロワーの不一致は残る。選択肢: (i) 当面 en ドロワーで許容（推奨）/ (ii) SPAに ja ロケール追加（別大工事）/ (iii) ja だけ deep-link 維持。
3. **App Check**: 決済 callable は App Check 必須。**本番 yah.mobi は許可済みで動作**するが、**プレビューチャンネルは未許可＝決済実走テそ不可**（P1と同じ制約）。→ 実走テストは本番マージ後 or チャンネル許可登録が必要。
4. **JSウェイト/Stripe**: 島は Firebase＋Stripe＋i18n を含み重い。**初回クリック遅延マウント**で初期ページは軽量維持。Stripe.js は決済ステップで既に遅延ロード。
5. **二重初期化**: Firebase/App Check/i18n はシングルトン初期化のため、島とSPAが同一ページに同居しない前提（/esim はSPA非搭載）なら衝突なし。要確認。

## 7. 段階実装（可逆・各段で検証）
1. **依存精査＋島スケルトン**: PurchaseDrawer を最小Providerでマウントする島を作り、ローカルで「開く/閉じる/プラン選択/ログインstepまで描画」を確認（wouter依存の要否を確定）。
2. **ガイド結線**: 購入ボタンを click横取り＋deep-linkフォールバックに。初回クリックで島を動的import&mount。
3. **検証**: ガイドから遷移せずドロワーが開く／GEO静的HTML（JS前）は無改修／SPA本体・既存deep-linkも無傷。
4. （本番マージ後）App Check 環境で決済実走を確認。

## 8. 検証計画
- `astro build` 生HTML: 購入ボタンは従来どおり `href` を保持（フォールバック健全）＝GEO無影響。
- `npm run dev:astro`＋プレビュー: 購入クリック→**その場でドロワー起動**（プラン事前選択）。閉じる/再オープン。ライト/ダーク。
- 回帰: `npm run build`（SPA無傷）／`tsc`／`eslint 0`／既存 client テスト。
- プレビューチャンネル: ドロワー起動・UI確認（決済実走は App Check 制約により本番で）。

## 9. 影響範囲・非対象
- 追加中心（新 island・ガイドの結線）。SPA本体は原則無改修（wouter shim を要する場合も島内に閉じる）。
- 非対象: SPAへの ja ロケール追加／プレビューチャンネルでの決済実走／多言語ドロワー。

## 10. 要ユーザー判断（承認時に確認したい点）
- **A. ja記事のドロワー言語**: 当面 en ドロワーで許容（推奨(i)）で良いか？
- **B. スコープ**: 「ガイド内で開く」までをP2とし、決済実走テストは本番マージ後で良いか？
- **C. wouter依存が重い場合の分岐**: ステップ1で「島化コストが高い（App context を広く要求する）」と判明したら、いったん deep-link 維持に戻して報告する方針で良いか？
