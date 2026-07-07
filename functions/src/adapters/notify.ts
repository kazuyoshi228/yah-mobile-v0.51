import * as logger from "firebase-functions/logger";
import { ENV } from "../env";
import { sendEmail } from "../mailer";
/**
 * functions/src/adapters/notify.ts — オーナー通知アダプター
 *
 * 到達性（S9）：単一チャンネル（forge/slack）だと、その1経路が失敗・未監視だと
 * アラートが誰にも届かない（2026-07 の実インシデントの根因）。そこで
 *  - プライマリ（NOTIFY_PROVIDER）を試し、失敗したら OWNER_EMAIL へメールでフォールバック。
 *  - critical=true の重大アラートは、プライマリ成否に関わらず必ずメールも送る。
 */
export interface NotifyOptions {
  title: string;
  content: string;
  /** 重大アラート。true のとき OWNER_EMAIL へのメールを必ず送る（発行系停止など）。 */
  critical?: boolean;
}

async function notifyViaForge(opts: NotifyOptions): Promise<boolean> {
  const forgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const forgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;
  if (!forgeApiUrl || !forgeApiKey) {
    logger.warn("[notify/forge] BUILT_IN_FORGE_API_URL or BUILT_IN_FORGE_API_KEY not set");
    return false;
  }
  const normalizedBase = forgeApiUrl.endsWith("/") ? forgeApiUrl : `${forgeApiUrl}/`;
  const endpoint = new URL("webdevtoken.v1.WebDevService/SendNotification", normalizedBase).toString();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: JSON.stringify({ title: opts.title, content: opts.content }),
    });
    if (!res.ok) {
      logger.warn(`[notify/forge] HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("[notify/forge] Error:", err);
    return false;
  }
}

async function notifyViaSlack(opts: NotifyOptions): Promise<boolean> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn("[notify/slack] SLACK_WEBHOOK_URL is not set");
    return false;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*${opts.title}*\n${opts.content}` }),
    });
    if (!res.ok) {
      logger.warn(`[notify/slack] HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("[notify/slack] Error:", err);
    return false;
  }
}

async function notifyViaEmail(opts: NotifyOptions): Promise<boolean> {
  const to = ENV.ownerEmail;
  if (!to) {
    logger.warn("[notify/email] OWNER_EMAIL is not set");
    return false;
  }
  try {
    const html = `<h2 style="margin:0 0 12px">${opts.title}</h2><pre style="white-space:pre-wrap;font-family:-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#333">${opts.content}</pre>`;
    await sendEmail({ to, subject: `[yah.mobile] ${opts.title}`, html });
    return true;
  } catch (err) {
    logger.warn("[notify/email] Error:", err);
    return false;
  }
}

async function notifyViaPrimary(opts: NotifyOptions): Promise<boolean> {
  const provider = process.env.NOTIFY_PROVIDER ?? "forge";
  switch (provider) {
    case "forge":
      return notifyViaForge(opts);
    case "slack":
      return notifyViaSlack(opts);
    default:
      logger.warn(`[notify] Unknown NOTIFY_PROVIDER: "${provider}"`);
      return false;
  }
}

export async function notifyOwner(opts: NotifyOptions): Promise<boolean> {
  const primaryOk = await notifyViaPrimary(opts);

  // critical はプライマリ成否に関わらずメール必達。非criticalはプライマリ失敗時のみメールにフォールバック。
  let emailOk = false;
  if (opts.critical || !primaryOk) {
    emailOk = await notifyViaEmail(opts);
  }

  const delivered = primaryOk || emailOk;
  if (!delivered) {
    logger.error(`[notify] ALL channels failed for alert: "${opts.title}" (owner may not be aware!)`);
  }
  return delivered;
}
