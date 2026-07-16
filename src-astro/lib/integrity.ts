/**
 * integrity.ts — ガイドの「消えてはいけないデータ」をビルド時に検査するゲート。
 *
 * 背景: magazine の import-md.mjs が `set(doc,{merge:false})`＝全置換で、
 * CMS専用フィールド（author 等）を再importで消す事故が起きた（多言語化時に author が null 化）。
 * ヘッド側で「期待されるフィールドが欠落したまま本番公開する」のを止める防波堤。
 *
 * 期待テーブル(EXPECT)= 各記事で「有るべき」フィールド。
 *  - author: 公開記事は常に有るべき（E-E-A-T）→ 欠落=失敗。
 *  - fieldReport: 任意。ただし一度載せたら消えたら困る → magazine が載せたら true に上げる（以降 欠落=失敗）。
 * 緊急回避: 環境変数 SKIP_GUIDE_INTEGRITY=1（本当に承知の上でのみ）。
 */
// esimGuides を import しない（循環回避）。必要な形だけ構造的に受ける。
interface GuideLike {
  slug: string;
  author?: { name?: string } | null;
  fieldReport?: string | null;
}

interface Expect {
  author: boolean;
  fieldReport: boolean;
}

// 未登録記事の既定（公開記事は著者必須）。
const DEFAULT_EXPECT: Expect = { author: true, fieldReport: false };

// 記事別の期待。フィールドを magazine に載せたら true に上げる（＝以降その消失を検知）。
const EXPECT: Record<string, Expect> = {
  // author・fieldReport とも magazine 掲載済み＝有るべき。欠落したらビルドで止める。
  "esim-chatgpt": { author: true, fieldReport: true },
};

function hasAuthor(g: GuideLike): boolean {
  return !!g.author?.name;
}
function hasFieldReport(g: GuideLike): boolean {
  return !!(g.fieldReport && g.fieldReport.trim());
}

/**
 * 期待フィールドの欠落を検査。欠落があれば例外で **ビルドを止める**（＝壊れた状態で公開しない）。
 * SKIP_GUIDE_INTEGRITY=1 のときは警告のみ。
 */
export function assertGuidesIntegrity(guides: EsimGuide[]): void {
  const violations: string[] = [];
  const promotable: string[] = []; // baseline を上げるべき（新規に載った）候補
  for (const g of guides) {
    const e = EXPECT[g.slug] ?? DEFAULT_EXPECT;
    if (e.author && !hasAuthor(g)) violations.push(`${g.slug}: author が欠落（期待=有）`);
    if (e.fieldReport && !hasFieldReport(g)) violations.push(`${g.slug}: fieldReport が欠落（期待=有）`);
    // 期待=無 だが実際は載っている → baseline を有に上げると以降保護される
    if (!e.fieldReport && hasFieldReport(g)) promotable.push(`${g.slug}.fieldReport`);
  }

  if (promotable.length) {
    console.info(`ℹ️ [integrity] 新規に存在するデータ（保護するには EXPECT を有に）: ${promotable.join(", ")}`);
  }

  if (violations.length === 0) return;

  const msg =
    `\n❌ ガイド整合性チェック失敗 — 欠落データで公開をブロックしました:\n` +
    violations.map((v) => `   - ${v}`).join("\n") +
    `\n→ magazine CMS で該当データを復旧し（例: 著者を再設定 / 実地レポートを保存）、feed に載ってから再ビルドしてください。\n` +
    `   （原因: magazine import-md.mjs の全置換。恒久対策は import 側で CMS専用フィールドを退避すること）\n` +
    `   緊急でどうしても公開する場合のみ SKIP_GUIDE_INTEGRITY=1 を付けてビルド。\n`;

  if (process.env.SKIP_GUIDE_INTEGRITY) {
    console.warn(`⚠️ [integrity] SKIP_GUIDE_INTEGRITY により続行（欠落あり）:${msg}`);
    return;
  }
  throw new Error(msg);
}
