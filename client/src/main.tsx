import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n"; // i18n初期化
import { loadUmamiIfConsented } from "@/lib/analytics";
import { initErrorReporting } from "@/lib/errorReporting";
import { initChatAuthBridge } from "@/lib/chatBridge";

// ブラウザの実行時エラー収集（PII非送信・S1(b)）を起動時に設置
initErrorReporting();

// 同意済みユーザーの場合のみ、サードパーティ解析を起動時に動的ロードする
loadUmamiIfConsented();

// chat ウィジェットへのログインSSO橋渡し（chat.yah.mobi からの要求に IDトークンを返す）
initChatAuthBridge();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5, // 5分
    },
  },
});

// Callable Functions のエラーハンドリング（未認証 → ログインページへ）
queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error as Error | null;
    if (!error) return;
    console.error("[API Query Error]", error);
    // Firebase Callable Functions の未認証エラー → その場でポップアップログイン
    if (error.message?.includes("unauthenticated") || error.message?.includes("UNAUTHENTICATED")) {
      const fallback = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
      // ※ queryCache のコールバックはユーザーの直接操作ではないため、
      //   ブラウザによってはポップアップがブロックされる。その場合は /login へフォールバック。
      import("./lib/firebase")
        .then(({ signInWithGoogle }) => signInWithGoogle().catch(() => { window.location.href = fallback; }))
        .catch(() => { window.location.href = fallback; });
    }
    if (error.message?.includes("EMAIL_NOT_ALLOWED") || error.message?.includes("email-not-allowed")) {
      window.location.href = "/unauthorized";
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error as Error | null;
    if (!error) return;
    console.error("[API Mutation Error]", error);
  }
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
