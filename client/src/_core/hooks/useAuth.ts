import {
  subscribeAuthState,
  signOutFirebase,
  getFirebaseDb,
} from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { FirebaseUser } from "@/lib/firebase";
import type { FsUser } from "../../../../shared/userTypes";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

/**
 * useAuth — Firebase Auth 認証フック
 *
 * 設計:
 *   1. Firebase Auth (onAuthStateChanged) で UID を確定する。
 *      → fbUser が確定した時点でログイン完了とみなす（スピナーを止める）。
 *   2. UID 確定後, Firestore の users/{uid} を onSnapshot でバックグラウンド監視。
 *      → dbUser は非同期で取得。取得中でもログイン済みとして扱う。
 *   3. Custom Claims の admin フラグを getIdTokenResult() で取得し isAdmin として公開。
 *      → admin 判定は Firestore role ではなく Custom Claims に一本化。
 */
export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/login" } =
    options ?? {};
  const [location, navigate] = useLocation();

  // Firebase Auth 状態
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [fbResolved, setFbResolved] = useState(false);
  // Custom Claims の admin フラグ（トークンリフレッシュ後に確定）
  const [isAdmin, setIsAdmin] = useState(false);

  // Firestore users/{uid} リアルタイム監視（バックグラウンド）
  const [dbUser, setDbUser] = useState<FsUser | null>(null);

  // 1. 初回マウント: Auth 状態監視開始
  useEffect(() => {
    const unsubAuth = subscribeAuthState(async (user) => {
      setFbUser(user);
      setFbResolved(true);
      if (!user) {
        setDbUser(null);
        setIsAdmin(false);
      } else {
        // Custom Claims（admin）をトークンから取得（forceRefresh=false でキャッシュ利用）
        try {
          const tokenResult = await user.getIdTokenResult();
          setIsAdmin(tokenResult.claims["admin"] === true);
        } catch {
          setIsAdmin(false);
        }

        // ユーザードキュメントの初期作成は onUserCreated トリガー（role 判定 + Custom Claims 付与）に一本化。
        // フロントからは作成しない（旧: client 直 setDoc は二重作成のため廃止）。
      }
    });
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
        } else {
          // doc の作成は onUserCreated トリガー（role 判定 + Custom Claims 付与の権威）に一本化。
          // 生成待ちの間は dbUser を null のままにし、state は fbUser 由来の最低限情報で構築する。
          setDbUser(null);
        }
      },
      (error) => {
        console.error("[useAuth] Firestore onSnapshot error:", error);
      }
    );

    return unsubDoc;
  }, [fbUser, fbResolved]);

  // 3. ログアウト
  const logout = useCallback(async () => {
    try {
      await signOutFirebase();
    } finally {
      setDbUser(null);
      setIsAdmin(false);
    }
  }, []);

  // 4. 状態のメモ化
  // fbResolved になった時点でローディング終了（Firestoreの取得完了を待たない）
  const state = useMemo(() => {
    // dbUser があればそれを使い、なければ fbUser から最低限の情報を構築
    const user: FsUser | null = fbUser
      ? dbUser ?? {
          id: fbUser.uid,
          uid: fbUser.uid,
          name: fbUser.displayName ?? fbUser.email ?? "User",
          email: fbUser.email ?? "",
          role: "user" as const,
          loginMethod: "google",
          createdAt: Date.now(),
          lastSignedIn: Date.now(),
          updatedAt: Date.now(),
        }
      : null;

    return {
      user,
      loading: !fbResolved, // Firebase Auth が確定すればローディング終了
      error: null,
      isAuthenticated: !!fbUser,
      isAdmin,
    };
  }, [fbUser, fbResolved, dbUser, isAdmin]);

  // 5. 未ログイン時の自動 SPA 遷移（wouter）
  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (state.loading) return;
    if (state.user) return;
    if (location === redirectPath) return;

    const currentPath = location + window.location.search;
    navigate(`${redirectPath}?redirect=${encodeURIComponent(currentPath)}`, {
      replace: true,
    });
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    state.loading,
    state.user,
    location,
    navigate,
  ]);

  return {
    ...state,
    logout,
  };
}
