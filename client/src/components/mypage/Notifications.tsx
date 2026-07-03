import { useAuth } from "@/_core/hooks/useAuth";
import { getFirebaseDb } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  type QuerySnapshot,
  type DocumentData,
} from "firebase/firestore";
import { motion } from "framer-motion";
import { useState, useEffect, useCallback } from "react";
import { Spinner } from "./Spinner";

// ─── 未読通知バッジ ────────────────────────────────────────────────────────────

export function NotificationBell({ onOpen }: { onOpen: () => void }) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user?.id) { setCount(0); return; }
    const q = query(
      collection(getFirebaseDb(), "notifications"),
      where("userId", "==", user.id),
      where("isRead", "==", "false"),
      orderBy("createdAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap: QuerySnapshot<DocumentData>) => {
      setCount(snap.size);
    });
    return unsub;
  }, [user?.id]);
  return (
    <button
      onClick={onOpen}
      className="relative inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-black/5 transition-colors duration-200"
      aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ""}`}
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current stroke-[1.5]" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {count > 0 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] bg-black text-white text-[0.55rem] font-sans font-medium rounded-full flex items-center justify-center px-1"
        >
          {count > 9 ? "9+" : count}
        </motion.span>
      )}
    </button>
  );
}

// ─── 通知パネル ────────────────────────────────────────────────────────────────

type FsNotif = {
  id: string;
  title: string;
  body?: string | null;
  isRead: string;
  createdAt: number;
};

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState<FsNotif[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // AP-05/AP-09: notificationsMarkRead Callable Function 不要 → Firestore 直接 update
  const handleMarkRead = useCallback(async (notifId: string) => {
    if (!user?.id) return;
    const ref = doc(getFirebaseDb(), "notifications", notifId);
    await updateDoc(ref, { isRead: true, readAt: Date.now() });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) { setUnread([]); setIsLoading(false); return; }
    const q = query(
      collection(getFirebaseDb(), "notifications"),
      where("userId", "==", user.id),
      where("isRead", "==", "false"),
      orderBy("createdAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap: QuerySnapshot<DocumentData>) => {
      setUnread(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FsNotif)));
      setIsLoading(false);
    });
    return unsub;
  }, [user?.id]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="absolute right-0 top-full mt-2 w-80 bg-white border border-black/10 shadow-xl z-50"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/8">
        <p className="text-label text-[0.6875rem] text-black/50">NOTIFICATIONS</p>
        <button onClick={onClose} className="font-sans text-black/30 hover:text-black text-lg leading-none">×</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {isLoading ? (
          <div className="py-8 flex justify-center"><Spinner /></div>
        ) : !unread || unread.length === 0 ? (
          <p className="font-sans text-black/30 text-sm text-center py-8">No new notifications</p>
        ) : (
          unread.map((n) => (
            <div key={n.id} className="px-4 py-3 border-b border-black/5 hover:bg-black/2 transition-colors duration-150">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-sans text-black text-sm font-medium mb-0.5">{n.title}</p>
                  {n.body && <p className="font-sans text-black/40 text-xs leading-[1.6]">{n.body}</p>}
                </div>
                <button
                  onClick={() => handleMarkRead(n.id)}
                  className="shrink-0 text-label text-[0.55rem] text-black/30 hover:text-black transition-colors duration-150 mt-0.5"
                >
                  ✓
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
