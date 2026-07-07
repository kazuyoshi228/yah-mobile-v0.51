/**
 * server/bappy/auth.ts — Bappy (OmaxTelecom) OAuth2 Client Credentials トークン管理
 */

import { getBappyTokenCached, setBappyTokenCached } from "../db";

/** OmaxTelecom ID トークンエンドポイント */
export const OMAX_TOKEN_URL =
  "https://id.omaxtelecom.com/realms/platform/protocol/openid-connect/token";

/** Bappy API ベースURL */
export const BAPPY_BASE_URL = "https://api.omaxtelecom.com/bappy/v1";

import { defineSecret } from "firebase-functions/params";

const omaxClientId = defineSecret("OMAX_CLIENT_ID");
const omaxClientSecret = defineSecret("OMAX_CLIENT_SECRET");

/** Bappy API が利用可能かどうか */
export function isBappyConfigured(): boolean {
  return !!(omaxClientId.value() && omaxClientSecret.value());
}

/** タイムアウト付きfetchヘルパー */
export function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * キャッシュを経由せず新規にトークンを取得する（失敗時は例外）。
 * 死活監視（providerHealthCheck）が「いま認証できるか」をライブ検証するのに使う。
 */
export async function fetchNewToken(): Promise<string> {
  const clientId = omaxClientId.value();
  const clientSecret = omaxClientSecret.value();

  if (!clientId || !clientSecret) {
    throw new Error("[Bappy] OMAX credentials not configured in Secret Manager.");
  }

  const res = await fetchWithTimeout(
    OMAX_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
    10000,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[Bappy] Token fetch failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  // 30秒マージンを引いてキャッシュ
  await setBappyTokenCached(data.access_token, data.expires_in - 30);
  return data.access_token;
}

export async function getAccessToken(): Promise<string> {
  const cached = await getBappyTokenCached();
  if (cached) return cached;
  return fetchNewToken();
}
