import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const dynamic = "force-dynamic";

const GRAPH_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const META_FETCH_TIMEOUT_MS = Number(process.env.META_FETCH_TIMEOUT_MS ?? "15000");

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message: string; type?: string; code?: number };
};

type PageRow = {
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id?: string; username?: string; name?: string };
};

type PagesResponse = {
  data?: PageRow[];
  paging?: { next?: string };
  error?: { message: string; type?: string; code?: number };
};

const PAGE_FIELDS = "instagram_business_account{id,username},name,access_token";

async function fetchAllManagedPages(accessToken: string): Promise<PageRow[]> {
  const collected: PageRow[] = [];
  const first = new URL(`${GRAPH_BASE}/me/accounts`);
  first.searchParams.set("fields", PAGE_FIELDS);
  first.searchParams.set("limit", "100");
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl) {
    const pagesRes = await fetchWithTimeout(
      nextUrl,
      {
        cache: "no-store",
      },
      META_FETCH_TIMEOUT_MS
    );
    const pagesJson = (await pagesRes.json()) as PagesResponse;

    if (!pagesRes.ok || pagesJson.error) {
      throw new Error(pagesJson.error?.message ?? "pages_fetch_failed");
    }

    if (pagesJson.data?.length) {
      collected.push(...pagesJson.data);
    }

    nextUrl = pagesJson.paging?.next?.trim() || null;
  }

  return collected;
}

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
  const fromEnv = process.env.META_REDIRECT_URI?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const publicOrigin = getPublicAppOrigin(request);
  return `${publicOrigin}/api/auth/meta`;
}

const IG_ACCOUNT_SELECTION_COOKIE = "meta_ig_account_selection";

function redirectScheduler(request: NextRequest, params: Record<string, string>) {
  const origin = getPublicAppOrigin(request);
  const target = new URL("/scheduler", origin.endsWith("/") ? origin : `${origin}/`);
  for (const [k, v] of Object.entries(params)) {
    target.searchParams.set(k, v);
  }
  return NextResponse.redirect(target);
}

/**
 * Meta / Facebook OAuth callback. Expects `state` = social_profiles.id to attach tokens.
 * Configure redirect URI in the Meta app to match META_REDIRECT_URI, NEXT_PUBLIC_APP_URL + /api/auth/meta,
 * or your deployment origin. Use NEXT_PUBLIC_APP_URL=http://localhost:3000 when the dev server binds 0.0.0.0.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const profileId = url.searchParams.get("state")?.trim() ?? "";
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const oauthErrorReason = url.searchParams.get("error_description");

  if (oauthError) {
    return redirectScheduler(request, {
      meta_error: oauthErrorReason || oauthError || "oauth_denied",
    });
  }

  if (!code?.trim()) {
    return redirectScheduler(request, { meta_error: "missing_code" });
  }

  if (!profileId) {
    return redirectScheduler(request, { meta_error: "missing_state_profile" });
  }

  const clientId = process.env.META_CLIENT_ID?.trim();
  const clientSecret = process.env.META_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return redirectScheduler(request, { meta_error: "server_missing_meta_credentials" });
  }

  const redirectUri = getRedirectUri(request);

  const shortTokenParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code: code.trim(),
  });

  let shortRes: Response;
  try {
    shortRes = await fetchWithTimeout(
      `${GRAPH_BASE}/oauth/access_token?${shortTokenParams.toString()}`,
      {
        cache: "no-store",
      },
      META_FETCH_TIMEOUT_MS
    );
  } catch (e) {
    console.error("[meta/oauth] short-lived token fetch failed:", e);
    return redirectScheduler(request, { meta_error: "token_exchange_network" });
  }

  const shortJson = (await shortRes.json()) as TokenResponse;

  if (!shortRes.ok || !shortJson.access_token) {
    return redirectScheduler(request, {
      meta_error: shortJson.error?.message ?? "short_lived_token_failed",
    });
  }

  const shortLivedToken = shortJson.access_token;

  const longTokenParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortLivedToken,
  });

  let longRes: Response;
  try {
    longRes = await fetchWithTimeout(
      `${GRAPH_BASE}/oauth/access_token?${longTokenParams.toString()}`,
      {
        cache: "no-store",
      },
      META_FETCH_TIMEOUT_MS
    );
  } catch (e) {
    console.error("[meta/oauth] long-lived token fetch failed:", e);
    return redirectScheduler(request, { meta_error: "long_lived_network" });
  }

  const longJson = (await longRes.json()) as TokenResponse;

  if (!longRes.ok || !longJson.access_token) {
    return redirectScheduler(request, {
      meta_error: longJson.error?.message ?? "long_lived_token_failed",
    });
  }

  const longLivedToken = longJson.access_token;

  let allPages: PageRow[];
  try {
    allPages = await fetchAllManagedPages(longLivedToken);
  } catch (e) {
    console.error("[meta/oauth] pages fetch failed:", e);
    const message = e instanceof Error ? e.message : "pages_fetch_failed";
    return redirectScheduler(request, { meta_error: message });
  }

  if (allPages.length === 0) {
    return redirectScheduler(request, {
      meta_error: "no_facebook_pages_check_pages_show_list",
    });
  }

  const withIg = allPages.filter(
    (p) => p.instagram_business_account?.id?.trim() && p.access_token?.trim()
  );

  if (withIg.length === 0) {
    return redirectScheduler(request, {
      meta_error: "no_ig_linked_link_professional_ig_to_page",
    });
  }

  const accounts = withIg.map((page) => ({
    pageName: page.name ?? "Facebook Page",
    igUsername: page.instagram_business_account?.username ?? null,
    igAccountId: page.instagram_business_account!.id!.trim(),
    pageAccessToken: page.access_token!.trim(),
  }));

  const cookiePayload = { profileId, accounts };
  const encoded = Buffer.from(JSON.stringify(cookiePayload), "utf8").toString("base64url");

  const origin = getPublicAppOrigin(request);
  const target = new URL("/scheduler", origin.endsWith("/") ? origin : `${origin}/`);
  target.searchParams.set("meta_select", "1");

  const res = NextResponse.redirect(target);
  res.cookies.set(IG_ACCOUNT_SELECTION_COOKIE, encoded, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });

  return res;
}
