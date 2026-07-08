/**
 * inspect-order-bwov753.mjs — 読み取り専用（書き込み一切なし）
 * 注文 bwov753WYkraxjQxh8Ug の eSIM 使用量・topup 状況を確認する。
 *   SA_KEY_PATH=/path/to/sa.json node scripts/inspect-order-bwov753.mjs
 *   もしくは ADC:  node scripts/inspect-order-bwov753.mjs
 */
import { readFileSync } from 'fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const saPath = process.env.SA_KEY_PATH;
initializeApp(saPath
  ? { credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) }
  : { credential: applicationDefault() });

const db = getFirestore();
const ORDER_ID = 'bwov753WYkraxjQxh8Ug';

const fmt = (v) => {
  if (v && typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v === 'number' && v > 1e12) return `${v} (${new Date(v).toISOString()})`;
  return v;
};

async function main() {
  console.log('=== ORDER:', ORDER_ID, '===');
  const orderSnap = await db.collection('orders').doc(ORDER_ID).get();
  if (!orderSnap.exists) { console.log('  NOT FOUND'); return; }
  const order = orderSnap.data();
  for (const k of ['status', 'orderType', 'bappyPlanId', 'planName', 'amountJpy', 'esimLinkUuid', 'userId', 'createdAt', 'refundStatus']) {
    console.log(`  ${k}:`, fmt(order[k]));
  }

  // esim_links: order の esimLinkUuid、無ければ orderId で逆引き
  console.log('\n=== ESIM_LINKS ===');
  let linkDocs = [];
  if (order.esimLinkUuid) {
    const d = await db.collection('esim_links').doc(order.esimLinkUuid).get();
    if (d.exists) linkDocs.push(d);
  }
  if (linkDocs.length === 0) {
    const q = await db.collection('esim_links').where('orderId', '==', ORDER_ID).get();
    linkDocs = q.docs;
  }
  if (linkDocs.length === 0) console.log('  (no esim_links found for this order)');
  for (const d of linkDocs) {
    const l = d.data();
    console.log(`  [link ${d.id}]`);
    for (const k of ['bappyLinkUuid', 'iccid', 'status', 'dataRemainingMb', 'dataTotalMb', 'lastActiveAt', 'expiryDate', 'syncRequestedAt']) {
      console.log(`    ${k}:`, fmt(l[k]));
    }
    const usage = await d.ref.collection('usage_logs').orderBy('createdAt', 'desc').limit(5).get().catch(() => null);
    if (usage && !usage.empty) {
      console.log(`    usage_logs (latest ${usage.size}):`);
      usage.docs.forEach((u) => {
        const x = u.data();
        console.log(`      - ${fmt(x.createdAt)} type=${x.eventType ?? x.type ?? '?'} remainMb=${x.dataRemainingMb}`);
      });
    } else {
      console.log('    usage_logs: (none)');
    }
  }

  // 購入可能な topup プラン
  console.log('\n=== TOPUP PLANS (planType=topup, isActive=true) ===');
  const tp = await db.collection('plans').where('planType', '==', 'topup').get();
  if (tp.empty) console.log('  (none)');
  tp.docs.forEach((p) => {
    const x = p.data();
    console.log(`  - ${p.id}: ${x.name} | ${x.dataGb ?? x.dataMb ?? '?'} | ${x.validityDays}d | ¥${x.priceJpy} | isActive=${x.isActive} | bappyPlanId=${x.bappyPlanId}`);
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
