# Firebase Authentication Improvements (Items 1-4) Instructions for MANUS

This document contains step-by-step instructions to implement the four authentication and authorization improvements in the `yah-mobile-v3` repository.

---

## Improvement 1: Invite-Only Whitelist Enforcement
Currently, anyone with a Google account can sign in because the whitelist (`allowed_emails`) is not validated in the backend API.

### Action Plan
Update `requireAuth` in `functions/src/callables/_helpers.ts` to check the email against the whitelist, allowing bypass only for the `ownerEmail` defined in the environment.

* **File**: `functions/src/callables/_helpers.ts`
* **Changes**:
```typescript
import { getUserByUid, upsertUserWithRole } from "../db/users";
import { isEmailAllowed } from "../db/admin"; // Add import
import { ENV } from "../env"; // Add import
```
* **Inside `requireAuth`**:
```typescript
export async function requireAuth(request: CallableRequest): Promise<AuthContext> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ログインが必要です。");
  }
  const uid = request.auth.uid;
  const email = request.auth.token.email;

  // 1. Email Whitelist Validation (Invite-Only)
  const isOwner = !!email && email.toLowerCase() === ENV.ownerEmail;
  if (email && !isOwner) {
    const isAllowed = await isEmailAllowed(email);
    if (!isAllowed) {
      throw new HttpsError("permission-denied", "email-not-allowed");
    }
  }

  // 2. Fetch or Auto-Onboard User
  let user = await getUserByUid(uid);
  if (!user) {
    try {
      await upsertUserWithRole({
        uid,
        name: request.auth.token.name ?? request.auth.token.email ?? "User",
        email: request.auth.token.email ?? null,
        loginMethod: "google",
      });
      user = await getUserByUid(uid);
    } catch (err) {
      console.error("[requireAuth] Auto-upsert failed:", err);
    }
    
    if (!user) {
      throw new HttpsError("not-found", "ユーザー情報が作成できませんでした。");
    }
  }
  return { uid, email, user };
}
```

---

## Improvement 2: Custom Claims Unification & Token Force-Refresh
Unify the admin check to look at Firebase Custom Claims (`request.auth.token.admin == true`), and implement a force-refresh helper on the frontend to solve propagation delay.

### Action Plan (Backend)
Update `requireAdmin` helper in `functions/src/callables/_helpers.ts` to check custom claims directly.

* **File**: `functions/src/callables/_helpers.ts`
* **Changes**:
```typescript
export async function requireAdmin(request: CallableRequest): Promise<AuthContext> {
  const ctx = await requireAuth(request);
  if (request.auth?.token.admin !== true) {
    throw new HttpsError("permission-denied", "管理者権限が必要です。");
  }
  return ctx;
}
```

### Action Plan (Frontend)
Update `useAuth.ts` to check Custom Claims for admin role and export `refreshClaims`.

* **File**: `client/src/_core/hooks/useAuth.ts`
* **Changes**:
```typescript
import { useCallback, useEffect, useMemo, useState } from "react";
// ... other imports

export function useAuth(options?: UseAuthOptions) {
  // ... other states
  const [isAdmin, setIsAdmin] = useState(false);

  // Parse custom claims when Firebase User is resolved
  useEffect(() => {
    if (fbUser) {
      fbUser.getIdTokenResult().then((result) => {
        setIsAdmin(!!result.claims.admin);
      }).catch(() => {
        setIsAdmin(false);
      });
    } else {
      setIsAdmin(false);
    }
  }, [fbUser]);

  // Force token refresh helper to avoid claims propagation delay
  const refreshClaims = useCallback(async () => {
    if (!fbUser) return;
    try {
      const result = await fbUser.getIdTokenResult(true); // force refresh JWT
      setIsAdmin(!!result.claims.admin);
    } catch (err) {
      console.error("[useAuth] Failed to refresh claims:", err);
    }
  }, [fbUser]);

  // Map user role based on Custom Claims
  const state = useMemo(() => {
    const user: FsUser | null = fbUser
      ? dbUser ?? {
          id: fbUser.uid,
          uid: fbUser.uid,
          name: fbUser.displayName ?? fbUser.email ?? "User",
          email: fbUser.email ?? "",
          role: isAdmin ? ("admin" as const) : ("user" as const),
          loginMethod: "google",
          createdAt: Date.now(),
          lastSignedIn: Date.now(),
          updatedAt: Date.now(),
        }
      : null;

    if (user && dbUser) {
      // Overlay custom claim status
      user.role = isAdmin ? "admin" : "user";
    }

    try {
      localStorage.setItem("manus-runtime-user-info", JSON.stringify(user));
    } catch {}

    return {
      user,
      loading: !fbResolved,
      error: null,
      isAuthenticated: !!fbUser,
    };
  }, [fbUser, fbResolved, dbUser, isAdmin]);

  return {
    ...state,
    logout,
    refreshClaims, // Export helper
  };
}
```

---

## Improvement 3: Account Suspension / Status Check
Enable account suspension by verifying the user's active status in the database.

### Action Plan
1. Add `status` field to the `FsUser` interface.
* **File**: `shared/userTypes.ts`
```typescript
export interface FsUser {
  // ... existing fields
  status?: "active" | "suspended" | null;
}
```

2. Assert that the account is active in `requireAuth` helper.
* **File**: `functions/src/callables/_helpers.ts`
* **Changes**:
```typescript
  // Inside requireAuth after fetching user
  if (user.status === "suspended") {
    throw new HttpsError("permission-denied", "account-suspended");
  }
```

---

## Improvement 4: Step-Up Authentication for Sensitive Admin Actions
Enforce re-authentication for highly sensitive actions (e.g. deleting plans or logs) if the login session is stale.

### Action Plan
1. Create a `requireFreshAuth` helper in `functions/src/callables/_helpers.ts`.
* **File**: `functions/src/callables/_helpers.ts`
```typescript
/**
 * Verifies that the login session is fresh (default max age: 15 minutes).
 * Used for critical administrative operations.
 */
export async function requireFreshAuth(request: CallableRequest, maxAgeSeconds = 900): Promise<AuthContext> {
  const ctx = await requireAuth(request);
  const authTime = request.auth?.token.auth_time;
  if (!authTime) {
    throw new HttpsError("failed-precondition", "Authentication timestamp missing.");
  }
  const age = (Date.now() / 1000) - authTime;
  if (age > maxAgeSeconds) {
    throw new HttpsError("failed-precondition", "reauthentication-required");
  }
  return ctx;
}
```

2. Apply the check to sensitive admin operations.
* **File**: `functions/src/callables/admin.ts`
* **Example**:
```typescript
export const adminDeletePlan = onCall({ region: REGION }, async (request) => {
  await requireFreshAuth(request, 600); // Require session fresh within 10 minutes
  const parsed = DeletePlanInput.safeParse(request.data);
  if (!parsed.success) throw zodError(parsed.error.message);
  await deletePlan(parsed.data.bappyPlanId);
  return { ok: true };
});
```

---

## Verification & Testing
1. **Whitelist Test**: Attempt to log in with an email not present in `allowed_emails` (and not matching `ownerEmail`). Confirm the API throws `permission-denied` and redirects to `/unauthorized`.
2. **Refresh Claims Test**: Update a user's Custom Claims on Firebase Console. Trigger `refreshClaims()` from the frontend console or UI, and verify the admin status updates without logout/login.
3. **Suspension Test**: Set a user document's `status` to `"suspended"` in Firestore. Attempt to invoke any authenticated callable function and verify it throws `permission-denied`.
4. **Step-Up Auth Test**: Log in, wait 10+ minutes, and attempt to delete a plan. Verify the backend rejects the request with `failed-precondition` / `"reauthentication-required"`.
