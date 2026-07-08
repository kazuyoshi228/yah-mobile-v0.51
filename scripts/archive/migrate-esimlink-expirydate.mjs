/**
 * migrate-esimlink-expirydate.mjs
 *
 * 目的: esim_links.expiryDate を ISO 文字列 → epoch ms(number) に一括変換する（DB-04 型統一）。
 *
 * 背景: esim_links.expiryDate は Bappy の ISO 文字列で保存されていたが、
 *       esim_activations.expiryDate は number(ms) で不一致だった。書込点(functions)を
 *       number 化したため、既存の string データを number に揃える。
 *
 * 冪等性: 値が number / null / 既にnumber の場合はスキップ。何度実行しても安全。
 *
 * 使用方法:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json node scripts/migrate-esimlink-expirydate.mjs
 *   （--dry で書き込みせず差分のみ表示）
 *   ※ まず --dry で対象件数を確認 → 0件なら実行不要。
 */
import { readFileSync } from 'fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = process.argv.includes('--dry');

const saPath = process.env.SA_KEY_PATH;
if (saPath) {
  initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
} else {
  initializeApp({ credential: applicationDefault() });
}

const db = getFirestore();

/** ISO文字列 → epoch ms。既に number/null は変換対象外（undefined を返す）。 */
function toEpochMs(v) {
  if (typeof v !== 'string') return undefined; // number / null / undefined はそのまま
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms; // 不正な文字列は null に正規化
}

async function migrate() {
  const snap = await db.collection('esim_links').get();
  let changed = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const next = toEpochMs(data.expiryDate);
    if (next === undefined) { skipped++; continue; } // 既に number / null
    console.log(`[esim_links/${doc.id}] expiryDate "${data.expiryDate}" -> ${next}`);
    if (!DRY_RUN) await doc.ref.update({ expiryDate: next, updatedAt: Date.now() });
    changed++;
  }
  console.log(`esim_links: ${changed} document(s) ${DRY_RUN ? 'would be' : ''} updated / ${skipped} skipped (already number/null).`);
}

async function main() {
  console.log(`=== esim_links.expiryDate ISO→epoch ms 移行 ${DRY_RUN ? '(dry-run)' : ''} ===`);
  await migrate();
  console.log('✅ Done.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
