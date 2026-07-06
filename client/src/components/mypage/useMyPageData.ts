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
// plan（bappyPlanId / doc.id）→ { validityDays, name } の索引
type PlanInfo = { validityDays?: number | null; name?: string | null };

export function useMyPageData(uid: string | undefined) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [esimLinks, setEsimLinks] = useState<EsimLink[] | null>(null);
  const [planMap, setPlanMap] = useState<Map<string, PlanInfo>>(new Map());

  // 有効期間（validityDays）等を注文の bappyPlanId / planId から引くための plans 索引
  useEffect(() => {
    const q = query(collection(getFirebaseDb(), "plans"), where("isActive", "==", true));
    const unsub = onSnapshot(q, (snap: QuerySnapshot<DocumentData>) => {
      const m = new Map<string, PlanInfo>();
      snap.docs.forEach((d) => {
        const p = d.data() as { bappyPlanId?: string; validityDays?: number; name?: string };
        const info: PlanInfo = { validityDays: p.validityDays ?? null, name: p.name ?? null };
        m.set(d.id, info);
        if (p.bappyPlanId) m.set(p.bappyPlanId, info);
      });
      setPlanMap(m);
    });
    return unsub;
  }, []);

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
  // plan を join して planName / validityDays を補完する
  const activeEsimList = useMemo(() => {
    if (!orders || !esimLinks) return [];
    return orders
      .filter((o) => o.status === "fulfilled")
      .map((o) => {
        const link = esimLinks.find((e) => e.orderId === o.id) ?? null;
        if (!link) return null;
        const oo = o as unknown as { bappyPlanId?: string; planId?: string };
        const plan = (oo.bappyPlanId && planMap.get(oo.bappyPlanId)) || (oo.planId && planMap.get(oo.planId)) || null;
        return { link, planName: plan?.name ?? o.planName ?? null, validityDays: plan?.validityDays ?? null };
      })
      .filter((x) => x !== null) as { link: EsimLink; planName: string | null; validityDays: number | null }[];
  }, [orders, esimLinks, planMap]);

  // 注文の planName を plans から解決（古い注文は planName 未保存のため「Japan eSIM」になる）
  const resolvedOrders = useMemo(() => {
    if (!orders) return orders;
    return orders.map((o) => {
      if (o.planName) return o;
      const oo = o as unknown as { bappyPlanId?: string; planId?: string };
      const plan = (oo.bappyPlanId && planMap.get(oo.bappyPlanId)) || (oo.planId && planMap.get(oo.planId)) || null;
      return plan?.name ? { ...o, planName: plan.name } : o;
    });
  }, [orders, planMap]);

  return { orders: resolvedOrders, ordersLoading, esimLinks, esimByOrderId, activeEsimList };
}
