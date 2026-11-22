import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@supabase/supabase-js";

import { assertSocialStaff } from "@/lib/server/assertSocialStaff";
import {
  fetchLinkedInOrganization,
  listAdministeredOrganizations,
} from "@/lib/server/metrics/linkedinMetrics";
import { linkedInClientId, publicAppOrigin } from "@/lib/server/socialPlatformConfig";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const dynamic = "force-dynamic";

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

function redirectUri(request: NextRequest): string {
  const fromEnv = process.env.LINKEDIN_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  return `${publicAppOrigin(request.nextUrl.origin)}/api/auth/linkedin`;
}

function finish(request: NextRequest, params: Record<string, string>) {
  const target = new URL("/scheduler", `${publicAppOrigin(request.nextUrl.origin)}/`);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target);
}

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function expiry(seconds: unknown): string | null {
  const value = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000).toISOString();
}

/**
 * LinkedIn OAuth callback. `state` is social_profiles.id.
 * Register the redirect URI in the LinkedIn app exactly.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const profileId = url.searchParams.get("state")?.trim() ?? "";
  const code = url.searchParams.get("code")?.trim() ?? "";
  const oauthError = url.searchParams.get("error");
  const oauthDescription = url.searchParams.get("error_description");

  if (oauthError) {
    return finish(request, { linkedin_error: oauthDescription || oauthError });
  }
  if (!code) return finish(request, { linkedin_error: "missing_code" });
  if (!profileId) return finish(request, { linkedin_error: "missing_state_profile" });

  const auth = await assertSocialStaff();
  if (!auth.ok) return finish(request, { linkedin_error: "not_authenticated" });

  const clientId = linkedInClientId();
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return finish(request, { linkedin_error: "server_missing_linkedin_credentials" });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(request),
    client_id: clientId,
    client_secret: clientSecret,
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetchWithTimeout(
      TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        cache: "no-store",
      },
      20000
    );
  } catch (error) {
    console.error("[linkedin/oauth] token exchange failed:", error instanceof Error ? error.message : "network");
    return finish(request, { linkedin_error: "token_exchange_network" });
  }

  const tokenJson = (await tokenResponse.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  } | null;

  const accessToken = tokenJson?.access_token?.trim();
  if (!tokenResponse.ok || !accessToken) {
    return finish(request, {
      linkedin_error: tokenJson?.error_description || tokenJson?.error || "token_exchange_failed",
    });
  }

  const supabase = serviceSupabase();
  if (!supabase) return finish(request, { linkedin_error: "server_database_not_configured" });

  let memberId: string | null = null;
  try {
    const userInfo = await fetchWithTimeout(
      "https://api.linkedin.com/v2/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      15000
    );
    const profile = (await userInfo.json().catch(() => null)) as { sub?: string } | null;
    memberId = profile?.sub?.trim() || null;
  } catch (error) {
    console.error("[linkedin/oauth] userinfo failed:", error instanceof Error ? error.message : "network");
  }

  const { error: dbError } = await supabase
    .from("social_profiles")
    .update({
      linkedin_access_token: accessToken,
      linkedin_refresh_token: tokenJson?.refresh_token?.trim() || null,
      linkedin_token_expires_at: expiry(tokenJson?.expires_in),
      linkedin_refresh_expires_at: expiry(tokenJson?.refresh_token_expires_in),
      linkedin_member_id: memberId,
      linkedin_scope: tokenJson?.scope?.trim() || null,
    })
    .eq("id", profileId);

  if (dbError) {
    console.error("[linkedin/oauth] supabase update:", dbError.message);
    return finish(request, { linkedin_error: "db_update_failed" });
  }

  const organizations = await listAdministeredOrganizations(accessToken);
  for (const organizationId of organizations.ids) {
    const details = await fetchLinkedInOrganization(accessToken, organizationId);
    const { error: orgError } = await supabase.from("linkedin_connected_organizations").upsert(
      {
        profile_id: profileId,
        organization_id: organizationId,
        organization_name: details.name,
        vanity_name: details.vanity,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,organization_id" }
    );
    if (orgError) {
      console.error("[linkedin/oauth] organization save:", orgError.message);
    }
  }

  if (organizations.ids.length === 0) {
    return finish(request, { linkedin_connected: "1", linkedin_warning: "no_organization" });
  }
  return finish(request, { linkedin_connected: "1" });
}
