# scripts/archive — 完了済みスクリプト置き場

ここにあるスクリプトは**役目を終えた一回限りの移行・調査スクリプト**です。
**再実行しないでください**（本番データに対する移行は完了済み。再実行すると壊す恐れがあります）。

| スクリプト | 用途（完了済み） |
|---|---|
| migrate-isactive-to-boolean.mjs | plans/比較表の isActive を文字列→boolean に統一（B1） |
| migrate-openid-to-uid.mjs | users の openId → uid 移行 |
| migrate-esimlink-expirydate.mjs | esim_links.expiryDate の正規化（DB-04） |
| inspect-order-bwov753.mjs | 特定注文 bwov753 の調査（topup問題の切り分け） |
| fix_mypage.py / inject_i18n.py / replace_console.py | 一括コード変換（実施済み） |

現役スクリプトは親ディレクトリ `scripts/` にあります（eSIMAccessプラン取込・admin権限付与など）。
