/**
 * db/notifications.ts — notifications のリポジトリ（P2・db.ts から無編集移動）
 */
import { db, collections, docToObj, queryToArr } from "./core";
import type { FsNotification } from "./core";

export async function createNotification(
  data: Omit<FsNotification, "id" | "createdAt" | "isRead"> & { isRead?: FsNotification["isRead"] },
): Promise<FsNotification> {
  const now = Date.now();
  const ref = await collections.notifications.add({ isRead: "false", ...data, createdAt: now });
  const snap = await ref.get();
  return docToObj<FsNotification>(snap)!;
}

export async function getNotificationsByUserId(userId: string, limit = 20): Promise<FsNotification[]> {
  const snap = await collections.notifications
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return queryToArr<FsNotification>(snap);
}

export async function markNotificationRead(id: string, _userId?: string): Promise<void> {
  await collections.notifications.doc(id).update({ isRead: "true" });
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const snap = await collections.notifications
    .where("userId", "==", userId)
    .where("isRead", "==", "false")
    .get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, { isRead: "true" }));
  await batch.commit();
}

export async function getUnreadNotifications(userId: string): Promise<FsNotification[]> {
  const all = await getNotificationsByUserId(userId, 50);
  return all.filter((n) => n.isRead === "false");
}
