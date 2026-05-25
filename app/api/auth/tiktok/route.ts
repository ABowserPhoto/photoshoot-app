import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const dynamic = "force-dynamic";

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const PKCE_COOKIE = "tiktok_pkce_verifier";
const TIKTOK_FETCH_TIMEOUT_MS = Number(process.env.TIKTOK_FETCH_TIMEOUT_MS ?? "30000");

type TokenSuccess = {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

function getPublicAppOrigin(request: NextRequest): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) {
    return fromEnv;
  }
  return request.nextUrl.origin;
}

function getRedirectUri(request: NextRequest): string {
  const fromEnv = process.env.TIKTOK_REDIRECT_URI?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const origin = getPublicAppOrigin(request);
  return `${origin.endsWith("/") ? origin.slice(0, -1) : origin}/api/auth/tiktok`;
}

function redirectScheduler(request: NextRequest, params: Record<string, string>) {
  const origin = getPublicAppOrigin(request);
  const target = new URL("/scheduler", origin.endsWith("/") ? origin : `${origin}/`);
  for (const [k, v] of Object.entries(params)) {
    target.searchParams.set(k, v);
  }
  return NextResponse.redirect(target);
}

/** Clear PKCE cookie after callback (success or failure). */
function withPkceCookieCleared(res: NextResponse) {
  res.cookies.set(PKCE_COOKIE, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

function finish(request: NextRequest, params: Record<string, string>) {
  return withPkceCookieCleared(redirectScheduler(request, params));
}

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function clientKey(): string | null {
  return (
    process.env.TIKTOK_CLIENT_KEY?.trim() ||
    process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY?.trim() ||
    null
  );
}

/**
 * TikTok OAuth callback. Expects `state` = social_profiles.id.
 * Register redirect URI in the TikTok developer portal (must match getRedirectUri()).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const profileId = url.searchParams.get("state")?.trim() ?? "";
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const oauthDescription = url.searchParams.get("error_description");

  if (oauthError) {
    return finish(request, {
      tiktok_error: oauthDescription || oauthError || "oauth_denied",
    });
  }

  if (!code?.trim()) {
    return finish(request, { tiktok_error: "missing_code" });
  }

  if (!profileId) {
    return finish(request, { tiktok_error: "missing_state_profile" });
  }

  const pkceVerifier = request.cookies.get(PKCE_COOKIE)?.value?.trim() ?? "";
  if (!pkceVerifier) {
    return finish(request, { tiktok_error: "missing_pkce_verifier" });
  }

  const key = clientKey();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();

  if (!key || !clientSecret) {
    return finish(request, { tiktok_error: "server_missing_tiktok_credentials" });
  }

  const redirectUri = getRedirectUri(request);

  const body = new URLSearchParams({
    client_key: key,
    client_secret: clientSecret,
    code: code.trim(),
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: pkceVerifier,
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetchWithTimeout(
      TOKEN_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cache-Control": "no-cache",
        },
        body: body.toString(),
        cache: "no-store",
      },
      TIKTOK_FETCH_TIMEOUT_MS
    );
  } catch (e) {
    console.error("[tiktok/oauth] token exchange failed:", e);
    return finish(request, { tiktok_error: "token_exchange_network" });
  }

  let tokenJson: TokenSuccess & { error?: string; error_description?: string; message?: string };
  try {
    tokenJson = (await tokenRes.json()) as typeof tokenJson;
  } catch {
    return finish(request, { tiktok_error: "token_invalid_json" });
  }

  if (tokenJson.error || !tokenJson.access_token?.trim()) {
    const msg =
      tokenJson.error_description ||
      tokenJson.message ||
      tokenJson.error ||
      (!tokenRes.ok ? `http_${tokenRes.status}` : "token_exchange_failed");
    return finish(request, { tiktok_error: msg });
  }

  const accessToken = tokenJson.access_token.trim();
  const refreshToken = tokenJson.refresh_token?.trim() ?? null;
  const openId = tokenJson.open_id?.trim() ?? null;

  const supabase = serviceSupabase();
  if (!supabase) {
    return finish(request, { tiktok_error: "server_database_not_configured" });
  }

  const { error: dbError } = await supabase
    .from("social_profiles")
    .update({
      tiktok_access_token: accessToken,
      tiktok_refresh_token: refreshToken,
      tiktok_open_id: openId,
    })
    .eq("id", profileId);

  if (dbError) {
    console.error("[tiktok/oauth] supabase update:", dbError);
    return finish(request, { tiktok_error: dbError.message || "db_update_failed" });
  }

  return finish(request, { tiktok_connected: "1" });
}
