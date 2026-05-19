import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PKCE_COOKIE = "tiktok_pkce_verifier";
const COOKIE_MAX_AGE = 600; // 10 minutes

function getPublicAppOrigin(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
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

function clientKey(): string | null {
  return (
    process.env.TIKTOK_CLIENT_KEY?.trim() ||
    process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY?.trim() ||
    null
  );
}

function redirectSchedulerError(request: NextRequest, message: string) {
  const origin = getPublicAppOrigin(request);
  const target = new URL("/scheduler", origin.endsWith("/") ? origin : `${origin}/`);
  target.searchParams.set("tiktok_error", message);
  return NextResponse.redirect(target);
}

/**
 * Starts TikTok OAuth with PKCE: stores code_verifier in HttpOnly cookie and redirects to authorize.
 */
export async function GET(request: NextRequest) {
  const profileId = request.nextUrl.searchParams.get("profileId")?.trim() ?? "";
  if (!profileId) {
    return redirectSchedulerError(request, "missing_profile_id");
  }

  const key = clientKey();
  if (!key) {
    return redirectSchedulerError(request, "server_missing_tiktok_client_key");
  }

  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("hex");

  const redirectUri = getRedirectUri(request);
  if (redirectUri.startsWith("http://") && process.env.NODE_ENV !== "production") {
    console.warn(
      "[tiktok/oauth] redirect_uri is HTTP (%s). TikTok Login Kit requires an https redirect in the developer portal; use an HTTPS tunnel (e.g. ngrok), set NEXT_PUBLIC_APP_URL / TIKTOK_REDIRECT_URI to that URL, and register it exactly.",
      redirectUri,
    );
  }
  const tiktokScopes = "user.info.basic,video.publish";

  const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authUrl.search = [
    `client_key=${encodeURIComponent(key)}`,
    `response_type=code`,
    `scope=${encodeURIComponent(tiktokScopes)}`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    `state=${encodeURIComponent(profileId)}`,
    `code_challenge=${encodeURIComponent(codeChallenge)}`,
    `code_challenge_method=S256`,
  ].join("&");

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(PKCE_COOKIE, codeVerifier, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });

  return res;
}
