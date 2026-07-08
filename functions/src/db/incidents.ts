/**
 * db/incidents.ts — incident_logs のリポジトリ（P2・db.ts から無編集移動）
 */
import { collections, docToObj, queryToArr } from "./core";
import type { FsIncidentLog } from "./core";

export async function createIncidentLogDoc(data: Omit<FsIncidentLog, "id" | "createdAt" | "updatedAt">): Promise<FsIncidentLog> {
  const now = Date.now();
  const ref = await collections.incidentLogs.add({ ...data, createdAt: now, updatedAt: now });
  const snap = await ref.get();
  return docToObj<FsIncidentLog>(snap)!;
}

export async function createIncidentLog(data: {
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail?: string | null;
  orderId?: string | null;
  userId?: string | null;
}): Promise<string> {
  const log = await createIncidentLogDoc({
    ...data,
    status: "open",
    notifiedOwner: false,
    notifiedOmax: false,
  });
  return log.id;
}

export async function getOpenIncidentLogs(): Promise<FsIncidentLog[]> {
  const snap = await collections.incidentLogs
    .where("status", "==", "open")
    .orderBy("createdAt", "desc")
    .get();
  return queryToArr<FsIncidentLog>(snap);
}

export async function getIncidentLogs(limit = 50): Promise<FsIncidentLog[]> {
  const snap = await getOpenIncidentLogs();
  return snap.slice(0, limit);
}

export async function getOpenIncidents(): Promise<FsIncidentLog[]> {
  return getOpenIncidentLogs();
}

export async function updateIncidentLog(id: string, data: Partial<FsIncidentLog>): Promise<void> {
  await collections.incidentLogs.doc(id).update({ ...data, updatedAt: Date.now() });
}

export async function resolveIncident(id: string, resolvedBy = "system"): Promise<void> {
  await updateIncidentLog(id, { status: "auto_resolved", resolvedAt: Date.now(), resolvedBy });
}

export async function markIncidentNotified(id: string, channel: "owner" | "omax"): Promise<void> {
  if (channel === "owner") {
    await updateIncidentLog(id, { notifiedOwner: true });
  } else {
    await updateIncidentLog(id, { notifiedOmax: true });
  }
}
