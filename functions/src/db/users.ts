/**
 * db/users.ts — users コレクションのリポジトリ（P2・db.ts から無編集移動）
 */
import { getFirebaseAuth } from "../firebase";
import { ENV } from "../env";
import { collections, docToObj, queryToArr } from "./core";
import type { FsUser } from "./core";

export async function getUserByUid(uid: string): Promise<FsUser | null> {
  const snap = await collections.users.doc(uid).get();
  return docToObj<FsUser>(snap);
}

export async function getUserById(id: string): Promise<FsUser | null> {
  const snap = await collections.users.doc(id).get();
  return docToObj<FsUser>(snap);
}

export async function upsertUser(
  uidOrData: string | (Partial<FsUser> & { uid: string }),
  data?: Partial<FsUser>,
): Promise<FsUser> {
  const uid = typeof uidOrData === "string" ? uidOrData : uidOrData.uid;
  const userData = typeof uidOrData === "string" ? (data ?? {}) : uidOrData;
  const now = Date.now();
  const ref = collections.users.doc(uid);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ ...userData, updatedAt: now, lastSignedIn: now });
  } else {
    await ref.set({
      uid,
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
      ...userData,
    });
  }
  const updated = await ref.get();
  return docToObj<FsUser>(updated)!;
}

export async function updateUser(id: string, data: Partial<FsUser>): Promise<void> {
  await collections.users.doc(id).update({ ...data, updatedAt: Date.now() });
}

export async function getAllUsers(): Promise<FsUser[]> {
  const snap = await collections.users.orderBy("createdAt", "desc").get();
  return queryToArr<FsUser>(snap);
}

export async function upsertUserWithRole(user: {
  uid: string;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  lastSignedIn?: Date | number | null;
  role?: "user" | "admin";
}): Promise<void> {
  if (!user.uid) throw new Error("User uid is required for upsert");
  const isOwnerEmail = !!user.email && user.email.toLowerCase() === ENV.ownerEmail;
  const role = user.role ?? (isOwnerEmail ? "admin" : "user");
  const lastSignedIn =
    user.lastSignedIn instanceof Date
      ? user.lastSignedIn.getTime()
      : (user.lastSignedIn ?? Date.now());
  await upsertUser(user.uid, {
    name: user.name ?? undefined,
    email: user.email ?? undefined,
    loginMethod: user.loginMethod ?? undefined,
    lastLoginAt: lastSignedIn,
    role,
  });
  // Custom Claims を Firestore role と同期（一本化）
  // role: "admin" → { admin: true }、role: "user" → { admin: false }
  await getFirebaseAuth().setCustomUserClaims(user.uid, { admin: role === "admin" });
}
