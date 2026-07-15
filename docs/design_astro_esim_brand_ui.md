# 設計図：/esim 静的ページを yah.mobi ブランドUIへ（P1追補）

対象ブランチ: `feat/astro-migration` ／ 作成: 2026-07-15 ／ ステータス: **実装済み（承認済み）**
出典: ユーザーFB「① 表の枠を白（ブランドのクリーンな表）に ② MENU bar は yah.mobi と共通のものを置く」。

## 実装ログ（2026-07-15）
- `src-astro/lib/ui-i18n.ts`（新）: ページchromeのUI文字列を lang で引く（ビルド時i18n・react-i18next非使用）。ja/en を定義、未定義langは en フォールバック。`formatAsOf` で料金基準日を言語別表記。
- `src-astro/layouts/BaseLayout.astro`: National2 @font-face（Storage OTF・CSP font-src既許可）＋**静的ブランドヘッダー**（YahLogo SVGをインライン＋`fill:currentColor`でライト/ダーク自動対応・nav/SIGN IN・モバイルはCSS`<details>`）＋**白基調ブランド表**（`--brand-*`変数でライト/ダーク両対応・角0）。
- `pages/esim/[lang]/[slug].astro`: 表見出し/購入/FAQ/基準日を `getUi(lang)`/`formatAsOf` に置換。
- ユーザー確認: 「表は添付（ダーク・枠線ありクリーン表）でOK」→ 罫線は消さず、ライト`#d7d7d7`/ダーク`#3a3a3a`で視認性を確保。
- 検証: astro build＋dev:astro（ライト/ダーク両モードでヘッダー適応・console/CSPエラー無し）＋ `npm run build`（SPA無傷・merged CSSにNational2）＋eslint 0エラー。
- 補足: SSOT連動確認 — ユーザーが 5GB(¥1,800) を無効化 → ガイドのプラン表は自動で 10GB(¥2,600) のみ表示。

## 背景・目的
P1で作った `/esim/ja/esim-chatgpt`（[[design_astro_geo_p1]]）は素の見た目（system-uiフォント・灰グリッドの表・ヘッダー無し）。yah.mobi ブランドの見た目に統一する。

## 方針（2点）

### ① 共通MENU bar = 「静的Astroヘッダー」で設置（島化しない）
- **理由**: 本物 `client/src/components/Nav.tsx` は wouter / Firebase Auth(`useAuth`) / i18n / framer-motion 依存の重量級。島化すると GEO静的ページに Firebase/i18n JS を載せることになり、P1の軽量・静的の利点を損なう（＝P2相当の作業）。
- **実装**: `client/src/components/YahLogo.tsx` は**純SVG**なので、その markup を Astro ヘッダーへインライン流用（dark `#231815`）。
  - リンク: HOME→`/app`、BUY→`/app?open=true`、PLANS→`/app#plans`、FAQ→`/app#faq`、CHAT→`/app#chat`、CONTACT→`/app#contact`（既存SPAのアンカーへ1遷移。プレーン `<a>`）。
  - SIGN IN: 静的ページは認証状態を持てないため **`<a href="/login">` 固定**（アカウント状態はSPA側で表示）。
  - 見た目: 本物の light 状態を再現 = 白バー（`bg:#fff/96 + backdrop-blur` 相当）＋下線 `#D7D7D7`、ロゴ h≈44px、リンク=`text-label`（National2 Medium・大文字・letter-spacing .18em・11px）、SIGN IN=枠線ボタン。sticky（本文に上パディング）。
  - モバイル: **JSなしのCSS `<details>` 開閉**でメニュー（GEO静的維持）。
  - 言語: P1は ja 固定のため、切替UIは置かず「JA」表示のみ（多言語化はfeed拡充後）。

### ② 表をブランド化（白セル＋細ハーライン）
- 現行の重い灰グリッド（cell全周 `#e3e3e3`）＋灰ヘッダ（`#fafafa`）を廃し、SPA（`PlansSection`/`ComparisonTable`）と同じ**白セル＋`#D7D7D7` 細ハーライン＋角0＋National2** に。
- 対象は2つ:
  - Astro生成の**プラン表**（`table.plans`）
  - 本文Markdown由来の**比較表**（marked生成 → `.article-body table` をCSSで同様に整える）
- ヘッダ行は白背景＋下線のみ・太字。ゼブラ/囲みは付けない（ブランドのミニマル準拠）。

### ③ ページ全体を National2 に
- `@font-face`（Regular/Medium）を Storage の既存OTF（`storage.googleapis.com/...National2-{Regular,Medium}.otf`）から読む。**CSP `font-src` は storage.googleapis.com 既許可**。`font-display: swap`。
- body の font-family を National2 優先に。

## 対象ファイル
- `src-astro/layouts/BaseLayout.astro`（@font-face追加・ヘッダーmarkup＋CSS・表CSS・body font）。ヘッダーが大きくなるなら `src-astro/components/SiteHeader.astro` に分離。
- ページ本体 `pages/esim/[lang]/[slug].astro` は変更ほぼ無し（レイアウトが吸収）。
- **SPA / functions / firestore.rules / storage.rules は無改修**。追加JSなし（静的維持）。

## 影響・リスク
- 追加中心・可逆。CSPは既存許可内（font-src/style-src）。
- フォントは外部OTF（swap）＝クローラは待たずにテキスト取得（GEO無影響）。

## 検証
1. `astro build` → 生HTMLに: ヘッダー（ロゴSVG・各リンクhref・SIGN IN→/login）、National2 `@font-face`、白基調の表。
2. `npm run dev:astro`（:4331）でプレビュー視覚確認（PC＋モバイル幅）。
3. `npm run build`（SPA回帰）＋ `tsc` ＋ `eslint`（0エラー）。
4. `astro` プレビューチャンネル再デプロイで実機確認（本番 dev/main は無改修）。

## 非対象（後続）
- 認証状態の動的表示・言語切替・フッター等はP2/多言語化で。
