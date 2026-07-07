# 実装設計書：DB-01 FsUserConsent 型の統一

対象ブランチ: `dev` ／ 作成: 2026-07-07 ／ ステータス: **提案（要承認）**
出典: 「yah.mobile DB改善 指示書 v1.0」DB-01 ／ 実コードで検証済み

## 実コード検証の結果（指示書との差異）
- `FsUserConsent` に**旧スキーマ**（`consentType`/`version`/`granted`/`consentedAt`）と**新スキーマ**（`termsVersion`/`privacyVersion`/`marketingOptIn`/`createdAt`）が併存＝**事実**。
- ただし **新スキーマ3フィールドは書き込みも読み取りも一切なし＝デッド**（`grep` で利用0）。
- `recordConsents()` は旧スキーマで3件（terms/privacy/marketing）を書くが、**`recordConsents` 自体が未呼び出し**（`createUserConsent` は `recordConsents` 内からのみ）。
- 実際の同意記録は `callables.ts` の購入フロー（`consentType: "purchase"` 等・旧スキーマ）側で行われている。
- `user_consents` は `firestore.rules` に定義なし＝**default-deny**（クライアント読書き不可・Admin SDK専用）。
- → **指示書の「読み取り側が新スキーマを期待」は該当なし。実データ移行を伴う“新スキーマへの全面移行”は機能的メリットが無い。**

## 方針（2案・推奨=A）

### ✅ 案A（推奨・低リスク）：デッドな新スキーマを削除し、旧スキーマに一本化
- `FsUserConsent` から **`termsVersion`/`privacyVersion`/`marketingOptIn` を削除**（未使用のため無害）。
- 実際に使う旧スキーマに統一：
  ```ts
  export interface FsUserConsent {
    id: string;
    userId: string;
    consentType: string;      // "terms" | "privacy" | "marketing" | "purchase"
    version?: string | null;
    granted?: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
    consentedAt?: number;
    createdAt?: number;
  }
  ```
- **データ移行不要・挙動不変・rules不変**。型が実体と一致し「二重化」が解消。
- （任意）未呼び出しの `recordConsents()` は削除候補だが、将来利用の可能性を残すなら保持可（別判断）。

### 案B（指示書どおり・高コスト）：単一ドキュメント新スキーマへ移行
- `recordConsents` を1ドキュメント（`termsGranted`/`privacyGranted`/`marketingGranted`）に変更＋既存3ドキュメント/ユーザーの移行スクリプト。
- **監査ログの粒度が変わる**（同意種別ごとの記録→1件）／移行スクリプト＋検証が必要。
- 現状の読取が新スキーマを使っていないため、**機能的な利得はない**。→ 非推奨。

## 影響範囲（案A）
- `shared/types.ts`（`FsUserConsent` 定義）のみ。
- `functions/src/db.ts`：型注釈は Omit ベースのため影響軽微（要ビルド確認）。
- rules・client・既存データ：変更なし。

## 検証計画（案A）
1. `functions` ビルド（`FsUserConsent` を使う箇所が壊れないこと）。
2. `npx tsc --noEmit`（client 波及なし確認）。
3. `functions` テスト・rules テスト（既存グリーン維持）。
4. `dev` コミット（デプロイ不要＝型のみ）。

## リスク・ロールバック
- 案A はデッドフィールド削除のみ＝**ほぼ無リスク**。万一参照が残っていればビルドで即検出。ロールバックは型を戻すだけ。

## 推奨
**案A（デッド新スキーマ削除）で統一**。移行・デプロイ不要で「二重化・不整合」を解消できる。指示書の案B（全面移行）は機能利得が無く不採用を推奨。
