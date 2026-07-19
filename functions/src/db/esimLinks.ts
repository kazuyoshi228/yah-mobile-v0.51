/**
 * db/esimLinks.ts — esim_links / esim_activations のリポジトリ（P2・db.ts から無編集移動）
 */
import { collections, docToObj, queryToArr } from "./core";
import type { FsEsimLink } from "./core";

export async function createEsimLink(
  data: Omit<FsEsimLink, "id" | "createdAt" | "updatedAt" | "status"> & {
    status?: FsEsimLink["status"];
  },
): Promise<FsEsimLink> {
  const now = Date.now();
  const ref = collections.esimLinks.doc(data.bappyLinkUuid);
  await ref.set({ status: "provisioning", ...data, createdAt: now, updatedAt: now });
  const snap = await ref.get();
  return docToObj<FsEsimLink>(snap)!;
}

export async function getEsimLinkByUuid(bappyLinkUuid: string): Promise<FsEsimLink | null> {
  const snap = await collections.esimLinks.doc(bappyLinkUuid).get();
  return docToObj<FsEsimLink>(snap);
}

export async function getEsimLinkByOrderId(orderId: string): Promise<FsEsimLink | null> {
  const snap = await collections.esimLinks.where("orderId", "==", orderId).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as FsEsimLink;
}

export async function getEsimLinksByUserId(userId: string): Promise<FsEsimLink[]> {
  const snap = await collections.esimLinks
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .get();
  return queryToArr<FsEsimLink>(snap);
}

export async function updateEsimLink(bappyLinkUuid: string, data: Partial<FsEsimLink>): Promise<void> {
  await collections.esimLinks.doc(bappyLinkUuid).update({ ...data, updatedAt: Date.now() });
}

export async function createEsimActivation(data: {
  esimLinkId: string;
  bappyActivationUuid: string;
  providerPlanId: string;
  activationType: "initial" | "topup";
  /** topup 冪等ガードの照会キー（fulfillEsim が orderId で既付与を検出する） */
  orderId?: string | null;
  expiryDate?: number | null;
  dataRemainingMb?: number | null;
  planName?: string | null;
  totalDataGb?: number | null;
}): Promise<{ id: string; bappyActivationUuid: string }> {
  const now = Date.now();
  const ref = await collections.esimActivations.add({
    ...data,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return { id: ref.id, bappyActivationUuid: data.bappyActivationUuid };
}

export async function getActiveActivationByEsimLinkId(
  esimLinkId: string,
): Promise<{ id: string; bappyActivationUuid: string; providerPlanId: string; status: string } | null> {
  const snap = await collections.esimActivations
    .where("esimLinkId", "==", esimLinkId)
    .where("status", "==", "active")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as { id: string; bappyActivationUuid: string; providerPlanId: string; status: string };
}

/** topup 冪等ガード: orderId で既存の付与記録を照会する（単一等価クエリ・インデックス不要） */
export async function getEsimActivationByOrderId(
  orderId: string,
): Promise<{ id: string; activationType?: string } | null> {
  const snap = await collections.esimActivations.where("orderId", "==", orderId).limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, activationType: (d.data() as { activationType?: string }).activationType };
}
