/**
 * migrate-openid-to-uid.mjs
 * Firestore の users コレクションで openId フィールドを uid にリネームする。
 * 既に uid フィールドがある場合はスキップ。
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountKey) {
  console.error("FIREBASE_SERVICE_ACCOUNT_KEY が設定されていません");
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountKey);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function migrate() {
  const snapshot = await db.collection("users").get();
  console.log(`対象ドキュメント数: ${snapshot.size}`);

  let updated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // 既に uid フィールドがある場合はスキップ
    if (data.uid) {
      console.log(`  SKIP: ${doc.id} (uid already exists: ${data.uid})`);
      skipped++;
      continue;
    }

    if (!data.openId) {
      console.log(`  SKIP: ${doc.id} (no openId field)`);
      skipped++;
      continue;
    }

    // uid を追加し、openId を削除
    await doc.ref.update({
      uid: data.openId,
      openId: FieldValue.delete(),
    });

    console.log(`  UPDATED: ${doc.id} → uid: ${data.openId}`);
    updated++;
  }

  console.log(`\n完了: ${updated} 件更新, ${skipped} 件スキップ`);
}

migrate().catch((err) => {
  console.error("移行エラー:", err);
  process.exit(1);
});
