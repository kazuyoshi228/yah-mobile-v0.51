# Firebase Auth & User Auto-Onboarding Fix Instructions

This document provides instructions for applying and verifying the Firebase Auth onboarding fix in the `yah-mobile-v3` repository.

## Context & Issue Description
In `yah-mobile-v3`, when a new user signs in using Google Auth (`signInWithPopup`), the frontend application handles authentication successfully, but does not immediately create the corresponding user document in the Firestore `/users/{uid}` collection.

When the user attempts to perform authenticated operations (e.g., initializing a checkout via `ordersInitCheckout`), the backend Cloud Functions call `requireAuth()`, which fetches `/users/{uid}`. Because the document does not exist, `requireAuth()` threw a `not-found` error ("ユーザーが見つかりません。"), blocking all authenticated flows for new users.

## Applied Changes
To resolve this issue, the user onboarding flow was automated via two-layer synchronization:
1. **Frontend Trigger**: Automatically invoke the `authUpsertUser` callable function in the background if the Firestore user snapshot does not exist.
2. **Backend Failsafe**: Automatically upsert the user document in `requireAuth()` if it is not found in Firestore.

---

### 1. Frontend Modification
Update `useAuth.ts` to trigger user registration in the background when the user's Firestore document is missing.

* **File**: [useAuth.ts](file:///Users/kazuyoshi228/Documents/yah-mobile-v3/client/src/_core/hooks/useAuth.ts)
* **Diff**:
```diff
@@ -8,6 +8,8 @@
 import { useLocation } from "wouter";
 import type { FirebaseUser } from "@/lib/firebase";
 import type { FsUser } from "../../../../shared/userTypes";
+import { callFunction } from "@/lib/callable";
+import { CALLABLE } from "@shared/callableSchemas";
 
 type UseAuthOptions = {
   redirectOnUnauthenticated?: boolean;
@@ -46,9 +48,17 @@
     return unsubAuth;
   }, []);
 
   // 2. Auth 確定後: Firestore users/{uid} をバックグラウンドで購読
   useEffect(() => {
     if (!fbResolved || !fbUser) return;
 
     const userDocRef = doc(getFirebaseDb(), "users", fbUser.uid);
     const unsubDoc = onSnapshot(
       userDocRef,
       (docSnap) => {
         if (docSnap.exists()) {
           setDbUser({ id: docSnap.id, ...docSnap.data() } as FsUser);
+        } else {
+          // Document does not exist: create it in the background
+          callFunction(CALLABLE.authUpsertUser, {
+            name: fbUser.displayName,
+            email: fbUser.email,
+            loginMethod: "google",
+          }).catch((error) => {
+            console.error("[useAuth] Failed to auto-upsert user:", error);
+          });
         }
       },
       (error) => {
         console.error("[useAuth] Firestore onSnapshot error:", error);
       }
     );
```

---

### 2. Backend Modification
Update Cloud Functions helper `requireAuth` to auto-create user records on-the-fly when processing authenticated API calls.

* **File**: [_helpers.ts](file:///Users/kazuyoshi228/Documents/yah-mobile-v3/functions/src/callables/_helpers.ts)
* **Diff**:
```diff
@@ -6,7 +6,7 @@
  */
 import { HttpsError } from "firebase-functions/v2/https";
 import type { CallableRequest } from "firebase-functions/v2/https";
-import { getUserByUid } from "../db/users";
+import { getUserByUid, upsertUserWithRole } from "../db/users";
 import type { FsUser } from "../db/types";
 
 export interface AuthContext {
@@ -16,6 +16,7 @@
 
 /**
  * 認証済みユーザーを取得する。未認証なら UNAUTHENTICATED を throw。
+ * ドキュメントが存在しない場合は自動作成（オンザフライ・オンボーディング）する。
  */
 export async function requireAuth(request: CallableRequest): Promise<AuthContext> {
   if (!request.auth) {
@@ -23,9 +24,23 @@
   const uid = request.auth.uid;
   const email = request.auth.token.email;
 
-  const user = await getUserByUid(uid);
+  let user = await getUserByUid(uid);
   if (!user) {
-    throw new HttpsError("not-found", "ユーザーが見つかりません。");
+    try {
+      await upsertUserWithRole({
+        uid,
+        name: request.auth.token.name ?? request.auth.token.email ?? "User",
+        email: request.auth.token.email ?? null,
+        loginMethod: "google",
+      });
+      user = await getUserByUid(uid);
+    } catch (err) {
+      console.error("[requireAuth] Auto-upsert failed:", err);
+    }
+    
+    if (!user) {
+      throw new HttpsError("not-found", "ユーザー情報が作成できませんでした。");
+    }
   }
   return { uid, email, user };
 }
```

## Verification Checklist
1. **Google Sign-In**: Authenticate a new user (with no pre-existing document in `/users` collection).
2. **Document Creation**: Confirm `/users/{uid}` document is created automatically in Firestore, populated with user info (`name`, `email`, `role: "user"`, `loginMethod: "google"`).
3. **API Access**: Run an authenticated action (e.g. creating an order). Confirm it executes successfully without throwing "ユーザーが見つかりません。".
