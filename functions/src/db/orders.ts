/**
 * db/orders.ts — orders コレクションのリポジトリ（P2・db.ts から無編集移動）
 */
import { collections, docToObj, queryToArr } from "./core";
import type { FsOrder } from "./core";

export async function createOrder(
  data: Omit<FsOrder, "id" | "createdAt" | "updatedAt" | "status" | "hiddenByUser"> & {
    status?: FsOrder["status"];
    hiddenByUser?: boolean;
  },
): Promise<FsOrder> {
  const now = Date.now();
  const ref = await collections.orders.add({
    status: "pending",
    hiddenByUser: false,
    ...data,
    createdAt: now,
    updatedAt: now,
  });
  const snap = await ref.get();
  return docToObj<FsOrder>(snap)!;
}

export async function getOrderById(id: string, userId?: string): Promise<FsOrder | null> {
  const snap = await collections.orders.doc(id).get();
  const order = docToObj<FsOrder>(snap);
  if (!order) return null;
  if (userId && order.userId !== userId) return null;
  return order;
}

export async function getOrderByStripeSessionId(sessionId: string): Promise<FsOrder | null> {
  const snap = await collections.orders.where("stripeSessionId", "==", sessionId).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as FsOrder;
}

export async function getOrderByStripePaymentIntentId(paymentIntentId: string): Promise<FsOrder | null> {
  const snap = await collections.orders.where("stripePaymentIntentId", "==", paymentIntentId).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as FsOrder;
}

export async function getOrdersByUserId(userId: string): Promise<FsOrder[]> {
  const snap = await collections.orders
    .where("userId", "==", userId)
    .where("hiddenByUser", "==", false)
    .orderBy("createdAt", "desc")
    .get();
  return queryToArr<FsOrder>(snap);
}

export async function getAllOrders(limit = 100): Promise<FsOrder[]> {
  const snap = await collections.orders.orderBy("createdAt", "desc").limit(limit).get();
  return queryToArr<FsOrder>(snap);
}

export async function updateOrder(id: string, data: Partial<FsOrder>): Promise<void> {
  await collections.orders.doc(id).update({ ...data, updatedAt: Date.now() });
}
