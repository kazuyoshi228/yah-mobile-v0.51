/**
 * db/inquiries.ts — contact_inquiries のリポジトリ（P2・db.ts から無編集移動）
 */
import { collections, docToObj, queryToArr } from "./core";
import type { FsContactInquiry } from "./core";

export async function createContactInquiry(
  data: Omit<FsContactInquiry, "id" | "createdAt" | "updatedAt" | "status"> & { status?: FsContactInquiry["status"] },
): Promise<FsContactInquiry> {
  const now = Date.now();
  const ref = await collections.contactInquiries.add({ ...data, createdAt: now, updatedAt: now });
  const snap = await ref.get();
  return docToObj<FsContactInquiry>(snap)!;
}

export async function getAllContactInquiries(): Promise<FsContactInquiry[]> {
  const snap = await collections.contactInquiries.orderBy("createdAt", "desc").get();
  return queryToArr<FsContactInquiry>(snap);
}

export async function updateContactInquiry(id: string, data: Partial<FsContactInquiry>): Promise<void> {
  await collections.contactInquiries.doc(id).update({ ...data, updatedAt: Date.now() });
}

export async function listInquiries(params?: {
  status?: "pending" | "in_progress" | "resolved" | "closed";
  limit?: number;
  offset?: number;
}): Promise<{ rows: FsContactInquiry[]; total: number }> {
  const all = await getAllContactInquiries();
  const filtered = params?.status ? all.filter((i) => i.status === params.status) : all;
  const total = filtered.length;
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 50;
  const rows = filtered.slice(offset, offset + limit);
  return { rows, total };
}

export async function updateInquiry(
  id: string,
  data: { status: "pending" | "in_progress" | "resolved" | "closed"; note?: string },
): Promise<void> {
  await updateContactInquiry(id, data);
}
