/**
 * markdown.ts — 本文(Markdown)→HTML（GEO静的ページ用）
 *
 * CJK対応: CommonMark は和文約物（」』）等の直後にある閉じ `**` を
 * right-flanking 規則で強調と認めない。magazine 本文は「…」** の形の日本語強調を
 * 多用するため、marked へ渡す前に **X** を <strong> へ正規化する。
 * 対象は「同一行で閉じた **…**（* と改行を含まない）」に限定 → 表セル/リストを壊さない。
 */
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md: string): string {
  const normalized = (md || "").replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  return marked.parse(normalized) as string;
}
