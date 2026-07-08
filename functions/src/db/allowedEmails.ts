/**
 * db/allowedEmails.ts — allowed_emails（招待制ホワイトリスト）のリポジトリ（P2・db.ts から無編集移動）
 */
import { collections, queryToArr } from "./core";
import type { FsAllowedEmail } from "./core";

export async function isEmailAllowed(email: string): Promise<boolean> {
  const snap = await collections.allowedEmails.doc(email.toLowerCase()).get();
  return snap.exists;
}

export async function getAllowedEmails(): Promise<FsAllowedEmail[]> {
  const snap = await collections.allowedEmails.orderBy("createdAt", "desc").get();
  return queryToArr<FsAllowedEmail>(snap);
}

export async function addAllowedEmail(
  emailOrData: string | { email: string; note?: string | null },
  note?: string,
): Promise<void> {
  const email = typeof emailOrData === "string" ? emailOrData : emailOrData.email;
  const noteVal = typeof emailOrData === "string" ? note : (emailOrData.note ?? undefined);
  const lower = email.toLowerCase();
  await collections.allowedEmails.doc(lower).set({
    email: lower,
    note: noteVal ?? null,
    createdAt: Date.now(),
  });
}

export async function removeAllowedEmail(email: string): Promise<void> {
  await collections.allowedEmails.doc(email.toLowerCase()).delete();
}

export async function deleteAllowedEmail(id: string): Promise<void> {
  await removeAllowedEmail(id);
}
