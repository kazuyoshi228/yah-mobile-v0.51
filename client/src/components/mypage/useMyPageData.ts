import { getFirebaseDb } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  type QuerySnapshot,
  type DocumentData,
} from "firebase/firestore";
import { useState, useEffect, useMemo } from "react";
import type { EsimLink, OrderRow, EsimPreview, EsimPreviewMap } from "./types";

/**
 * MyPage の注文・eSIM リンクを Firestore onSnapshot でリアルタイム購読し、
 * 表示用の派生データ（orderId→eSIMプレビュー Map、アクティブeSIM一覧）を返す。
 */
export function useMyPageData(uid: string | undefined) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [esimLinks, setEsimLinks] = useState<EsimLink[] | null>(null);

  useEffect(() => {
    if (!uid) {
      setOrders(null);
      setOrdersLoading(false);
      setEsimLinks(null);
      return;
    }
    const ordersQuery = query(
      collection(getFirebaseDb(), "orders"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
    );
    const unsubOrders = onSnapshot(ordersQuery, (snap: QuerySnapshot<DocumentData>) => {
      // hiddenByUser フィールドが存在しない古い注文も含めてクライアント側でフィルタリング
      setOrders(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as OrderRow))
          .filter((o) => (o as unknown as { hiddenByUser?: boolean }).hiddenByUser !== true)
      );
      setOrdersLoading(false);
    });
    const esimQuery = query(
      collection(getFirebaseDb(), "esim_links"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
    );
    const unsubEsim = onSnapshot(esimQuery, (snap: QuerySnapshot<DocumentData>) => {
      setEsimLinks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as EsimLink)));
    });
    return () => { unsubOrders(); unsubEsim(); };
  }, [uid]);

  // orderId → esimPreview のMap
  const esimByOrderId = useMemo<EsimPreviewMap>(
    () => new Map((esimLinks ?? []).map((e) => [e.orderId, e as EsimPreview])),
    [esimLinks],
  );

  // アクティブeSIMリスト（fulfilled かつ esimLink がある全注文）
  const activeEsimList = useMemo(() => {
    if (!orders || !esimLinks) return [];
    return orders
      .filter((o) => o.status === "fulfilled")
      .map((o) => {
        const link = esimLinks.find((e) => e.orderId === o.id) ?? null;
        return link ? { link, planName: null } : null;
      })
      .filter((x) => x !== null) as { link: EsimLink; planName: string | null }[];
  }, [orders, esimLinks]);

  return { orders, ordersLoading, esimLinks, esimByOrderId, activeEsimList };
}
