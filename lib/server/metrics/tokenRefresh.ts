import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";
import { sanitizeProviderError } from "@/lib/socialMetricsModel";
import { linkedInClientId, tiktokClientKey } from "@/lib/server/socialPlatformConfig";

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const TIMEOUT_MS = 20000;

export type RefreshedToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  openId: string | null;
  scope: string | null;
};

function expiry(seconds: unknown): string | null {
  const value = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000).toISOString();
}

export async function refreshTikTokAccessToken(refreshToken: string): Promise<
  { ok: true; token: RefreshedToken } | { ok: false; error: string }
> {
  const key = tiktokClientKey();
  const secret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!key || !secret) {
    return { ok: false, error: "TikTok is not configured yet. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET." };
  }

  const body = new URLSearchParams({
    client_key: key,
    client_secret: secret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  let response: Response;
  try {
    response = await fetchWithTimeout(
      TIKTOK_TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
        body: body.toString(),
        cache: "no-store",
      },
      TIMEOUT_MS
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "network_error";
    return { ok: false, error: sanitizeProviderError(message) };
  }

  const json = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    open_id?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
    message?: string;
  } | null;

  const accessToken = json?.access_token?.trim();
  if (!response.ok || !accessToken) {
    return {
      ok: false,
      error: sanitizeProviderError(
        json?.error_description || json?.message || json?.error || "TikTok token refresh failed."
      ),
    };
  }

  return {
    ok: true,
    token: {
      accessToken,
      refreshToken: json?.refresh_token?.trim() || null,
      expiresAt: expiry(json?.expires_in),
      refreshExpiresAt: expiry(json?.refresh_expires_in),
      openId: json?.open_id?.trim() || null,
      scope: json?.scope?.trim() || null,
    },
  };
}

export async function refreshLinkedInAccessToken(refreshToken: string): Promise<
  { ok: true; token: RefreshedToken } | { ok: false; error: string }
> {
  const clientId = linkedInClientId();
  const secret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !secret) {
    return { ok: false, error: "LinkedIn is not configured yet. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET." };
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: secret,
  });

  let response: Response;
  try {
    response = await fetchWithTimeout(
      LINKEDIN_TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        cache: "no-store",
      },
      TIMEOUT_MS
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "network_error";
    return { ok: false, error: sanitizeProviderError(message) };
  }

  const json = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  } | null;

  const accessToken = json?.access_token?.trim();
  if (!response.ok || !accessToken) {
    return {
      ok: false,
      error: sanitizeProviderError(
        json?.error_description || json?.error || "LinkedIn token refresh failed. Reconnect the account."
      ),
    };
  }

  return {
    ok: true,
    token: {
      accessToken,
      refreshToken: json?.refresh_token?.trim() || refreshToken,
      expiresAt: expiry(json?.expires_in),
      refreshExpiresAt: expiry(json?.refresh_token_expires_in),
      openId: null,
      scope: json?.scope?.trim() || null,
    },
  };
}

export function tokenExpiresSoon(iso: string | null | undefined, skewMs = 5 * 60 * 1000): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return false;
  return time <= Date.now() + skewMs;
}
