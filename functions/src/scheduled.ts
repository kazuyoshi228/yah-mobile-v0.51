import * as logger from "firebase-functions/logger";
/**
 * functions/src/scheduled.ts — Consolidated scheduled cron background jobs
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { processPendingRetries } from "./esimRetryService";
import { db } from "./db";
import { notifyOwner } from "./adapters/notify";
import { esimaccessProvider } from "./providers/esimaccess";
import { isEsimAccessConfigured } from "./esimaccess/auth";
// シークレット宣言は secrets.ts に一元化（P1-1）
import {
  omaxClientId,
  omaxClientSecret,
  gmailUser,
  gmailPass,
  forgeApiKey,
  slackWebhookUrl,
  stripeSecretKey,
  ownerEmail,
  esimAccessCode,
  esimSecretKey,
} from "./secrets";

export const esimRetryJob = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "asia-northeast1",
    timeoutSeconds: 300,
    secrets: [omaxClientId, omaxClientSecret, gmailUser, gmailPass, forgeApiKey, slackWebhookUrl, stripeSecretKey, ownerEmail, esimAccessCode, esimSecretKey],
  },
  async () => {
    logger.info("[esimRetryJob] Starting eSIM retry job...");
    try {
      const result = await processPendingRetries();
      logger.info(
        `[esimRetryJob] Processed ${result.processed} retries, ${result.succeeded} succeeded, ${result.failed} failed`
      );
    } catch (err) {
      logger.error("[esimRetryJob] Error:", err);
    }
  }
);

/**
 * 宙吊り注文モニター：status="provisioning" のまま30分以上放置された注文を検出しオーナー通知。
 * Webhookがリトライジョブ作成前に落ちた等で、どのジョブにも拾われない注文を拾う安全網。
 * （単一等価クエリ＋in-memory判定で複合インデックス不要）
 */
export const hungOrderMonitor = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "asia-northeast1",
    timeoutSeconds: 120,
    secrets: [forgeApiKey, slackWebhookUrl, gmailUser, gmailPass, ownerEmail],
  },
  async () => {
    // createdAt/updatedAt の型ゆらぎ（旧注文=Timestamp / 現行=number）をミリ秒に正規化
    const toMs = (v: unknown): number => {
      if (typeof v === "number") return v;
      const ts = v as { toMillis?: () => number } | null | undefined;
      if (ts && typeof ts.toMillis === "function") return ts.toMillis();
      return 0;
    };
    try {
      const THIRTY_MIN = 30 * 60 * 1000;
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();

      // 1) 実在する停滞状態を監視する: paid（発行が始まらない）/ pending_retry（リトライが進まない）。
      //    旧実装はどのコードパスも設定しない "provisioning" を監視しており安全網が機能していなかった
      const hung: string[] = [];
      for (const status of ["paid", "pending_retry"] as const) {
        const snap = await db.collection("orders").where("status", "==", status).get();
        for (const d of snap.docs) {
          const data = d.data() as { updatedAt?: unknown; createdAt?: unknown };
          const ts = toMs(data.updatedAt) || toMs(data.createdAt);
          if (ts > 0 && now - ts > THIRTY_MIN) {
            hung.push(`${d.id} (${status}, updated ${new Date(ts).toISOString()})`);
          }
        }
      }
      if (hung.length > 0) {
        logger.warn(`[hungOrderMonitor] ${hung.length} hung order(s) detected.`);
        await notifyOwner({
          title: `⚠️ 宙吊り注文 ${hung.length}件（paid/pending_retry が30分以上停滞）`,
          content: hung.join("\n").slice(0, 1500),
        });
      } else {
        logger.info("[hungOrderMonitor] No hung orders.");
      }

      // 2) 決済離脱の pending を24時間で自動失効（checkout.session.expired の補完。
      //    旧 Timestamp 型 createdAt の残骸もここで掃除される）
      const pendingSnap = await db.collection("orders").where("status", "==", "pending").get();
      let expired = 0;
      for (const d of pendingSnap.docs) {
        const data = d.data() as { createdAt?: unknown };
        const ts = toMs(data.createdAt);
        if (ts > 0 && now - ts > DAY) {
          await d.ref.update({ status: "cancelled", updatedAt: now });
          expired++;
        }
      }
      if (expired > 0) logger.info(`[hungOrderMonitor] Expired ${expired} stale pending order(s) (>24h).`);
    } catch (err) {
      logger.error("[hungOrderMonitor] Error:", err);
    }
  }
);

/**
 * S10 プロバイダ死活/認証監視：Bappy(OMAX)認証を15分ごとにライブ検証し、
 * 401/失敗（＝発行/topup/同期が止まるおそれ）を検知してオーナーへ即通知（S9のメール必達に乗せる）。
 * 2026-07 の「認証失効に4日気づかなかった」インシデントの再発防止。
 * 状態は system_config/provider_health に記録し、通知はデバウンス（down遷移で即／継続は1時間に1回／復旧も1回）。
 * eSIMAccess は柱2導入後に本関数へ追加予定。
 */
// 残高がこれ未満なら（downではないが）オーナーに補充を促す警告を出す。
const LOW_BALANCE_USD = 20;

export const providerHealthCheck = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "asia-northeast1",
    timeoutSeconds: 120,
    secrets: [esimAccessCode, esimSecretKey, gmailUser, gmailPass, forgeApiKey, slackWebhookUrl, ownerEmail],
  },
  async () => {
    if (!isEsimAccessConfigured()) {
      logger.info("[providerHealthCheck] eSIMAccess not configured. Skipping.");
      return;
    }

    const ONE_HOUR = 60 * 60 * 1000;
    const ref = db.collection("system_config").doc("provider_health");
    const now = Date.now();

    // 残高ping（署名付き軽量read＝課金なし）。成功=API/認証が生きている＝発行可能。
    let ok = false;
    let balanceUsd: number | null = null;
    let errMsg = "";
    try {
      const r = await esimaccessProvider.queryBalance!();
      balanceUsd = r.balanceUsd;
      ok = true;
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
    }

    const snap = await ref.get();
    const prev = (snap.exists ? snap.data()?.esimaccess : undefined) as
      | { status?: string; lastAlertAt?: number; consecutiveFails?: number; lowBalanceAlertAt?: number }
      | undefined;
    const prevStatus = prev?.status ?? "ok";

    if (ok) {
      if (prevStatus === "down") {
        await notifyOwner({
          critical: true,
          title: "✅ eSIMAccess 復旧（販売再開可）",
          content: `eSIMAccess API が回復しました（${new Date(now).toISOString()}）。残高 $${balanceUsd?.toFixed(2)}。販売停止ガードは自動解除され、購入を再開できます。`,
        });
      }
      // 残高低下の警告（downではない。1時間に1回まで）。0以下は発行が失敗しうるため強めに。
      let lowBalanceAlertAt = prev?.lowBalanceAlertAt ?? 0;
      if (balanceUsd != null && balanceUsd < LOW_BALANCE_USD && now - lowBalanceAlertAt >= ONE_HOUR) {
        await notifyOwner({
          critical: balanceUsd <= 0,
          title: `⚠️ eSIMAccess 残高低下 $${balanceUsd.toFixed(2)}`,
          content: `eSIMAccess の残高が $${balanceUsd.toFixed(2)}（閾値 $${LOW_BALANCE_USD}）です。残高が尽きると発行が失敗し自動返金になります。ダッシュボードで補充してください。`,
        });
        lowBalanceAlertAt = now;
      }
      await ref.set(
        { esimaccess: { status: "ok", lastOkAt: now, balanceUsd, consecutiveFails: 0, lowBalanceAlertAt } },
        { merge: true },
      );
      logger.info(`[providerHealthCheck] eSIMAccess OK / balance $${balanceUsd?.toFixed(2)}`);
      return;
    }

    // down（API/認証ダウン）→ 販売停止ガードON（購入callableが弾く）
    const consecutiveFails = (prev?.consecutiveFails ?? 0) + 1;
    const lastAlertAt = prev?.lastAlertAt ?? 0;
    const isTransition = prevStatus !== "down";
    const shouldRealert = now - lastAlertAt >= ONE_HOUR;

    if (isTransition || shouldRealert) {
      await notifyOwner({
        critical: true,
        title: "🚨 eSIMAccess ダウン（販売停止ガードON）",
        content: `eSIMAccess API への疎通/署名に失敗しています。**購入は自動停止**（課金しない）され、in-flightの失敗は自動返金されます。\n\n**連続失敗:** ${consecutiveFails}回\n**エラー:** ${errMsg.slice(0, 500)}\n\n確認：ESIMACCESS_ACCESS_CODE/ESIMACCESS_SECRET_KEY・api.esimaccess.com への疎通・署名(RT-*)。`,
      });
    }
    await ref.set(
      {
        esimaccess: {
          status: "down",
          lastDownAt: now,
          lastAlertAt: isTransition || shouldRealert ? now : lastAlertAt,
          consecutiveFails,
        },
      },
      { merge: true },
    );
    logger.error(`[providerHealthCheck] eSIMAccess DOWN (fails=${consecutiveFails}): ${errMsg}`);
  }
);
