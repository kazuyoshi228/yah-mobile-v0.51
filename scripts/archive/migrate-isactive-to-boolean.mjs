/**
 * migrate-isactive-to-boolean.mjs
 *
 * 目的: plans / competitorPlans に残る文字列 "true"/"false" の isActive・isHighlight を
 *       ネイティブ boolean に一括変換する（型統一のためのワンショット移行）。
 *
 * 背景: 旧実装ではフロント/管理画面が文字列 "true"/"false" を書き込む一方、
 *       購入処理 (ordersInitCheckout) は boolean で照合していたため、
 *       文字列で保存されたプランが購入不能になっていた。
 *
 * 使用方法:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json node scripts/migrate-isactive-to-boolean.mjs
 *   （--dry で書き込みせず差分のみ表示）
 */
import { readFileSync } from 'fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = process.argv.includes('--dry');

// サービスアカウント: GOOGLE_APPLICATION_CREDENTIALS 優先、なければ SA_KEY_PATH
const saPath = process.env.SA_KEY_PATH;
if (saPath) {
  initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
} else {
  // GOOGLE_APPLICATION_CREDENTIALS 環境変数を利用
  initializeApp({ credential: applicationDefault() });
}

const db = getFirestore();

/** 文字列 "true"/"false" を boolean に正規化。boolean はそのまま返す。 */
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined; // 未知の値は触らない
}

async function migratePlans() {
  const snap = await db.collection('plans').get();
  let changed = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (typeof data.isActive === 'string') {
      const next = toBool(data.isActive);
      if (next === undefined) continue;
      console.log(`[plans/${doc.id}] isActive "${data.isActive}" -> ${next}`);
      if (!DRY_RUN) await doc.ref.update({ isActive: next });
      changed++;
    }
  }
  console.log(`plans: ${changed} document(s) ${DRY_RUN ? 'would be' : ''} updated.`);
}

async function migrateCompetitorPlans() {
  const ref = db.collection('competitorPlans').doc('main');
  const snap = await ref.get();
  if (!snap.exists) {
    console.log('competitorPlans/main: not found, skipping.');
    return;
  }
  const data = snap.data();
  let touched = false;

  const columns = Array.isArray(data.columns)
    ? data.columns.map((c) => {
        const b = toBool(c.isActive);
        if (b !== undefined && b !== c.isActive) { touched = true; return { ...c, isActive: b }; }
        return c;
      })
    : data.columns;

  const rows = Array.isArray(data.rows)
    ? data.rows.map((r) => {
        const next = { ...r };
        const a = toBool(r.isActive);
        const h = toBool(r.isHighlight);
        if (a !== undefined && a !== r.isActive) { next.isActive = a; touched = true; }
        if (h !== undefined && h !== r.isHighlight) { next.isHighlight = h; touched = true; }
        return next;
      })
    : data.rows;

  if (touched) {
    console.log('[competitorPlans/main] normalizing isActive/isHighlight to boolean');
    if (!DRY_RUN) await ref.update({ columns, rows });
  } else {
    console.log('competitorPlans/main: already boolean, no change.');
  }
}

async function main() {
  console.log(`=== isActive/isHighlight → boolean 移行 ${DRY_RUN ? '(dry-run)' : ''} ===`);
  await migratePlans();
  await migrateCompetitorPlans();
  console.log('✅ Done.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
