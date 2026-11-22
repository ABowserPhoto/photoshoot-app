import { NextRequest, NextResponse } from "next/server";

import { assertSocialStaff } from "@/lib/server/assertSocialStaff";
import { linkedInClientId, publicAppOrigin } from "@/lib/server/socialPlatformConfig";
import { LINKEDIN_OAUTH_SCOPES } from "@/lib/socialOAuthScopes";

export const dynamic = "force-dynamic";

function redirectUri(request: NextRequest): string {
  const fromEnv = process.env.LINKEDIN_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  return `${publicAppOrigin(request.nextUrl.origin)}/api/auth/linkedin`;
}

function schedulerError(request: NextRequest, message: string) {
  const target = new URL("/scheduler", `${publicAppOrigin(request.nextUrl.origin)}/`);
  target.searchParams.set("linkedin_error", message);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const auth = await assertSocialStaff();
  if (!auth.ok) {
    return schedulerError(request, "not_authenticated");
  }

  const profileId = request.nextUrl.searchParams.get("profileId")?.trim() ?? "";
  if (!profileId) {
    return schedulerError(request, "missing_profile_id");
  }

  const clientId = linkedInClientId();
  if (!clientId) {
    return schedulerError(request, "server_missing_linkedin_client_id");
  }

  const dialog = new URL("https://www.linkedin.com/oauth/v2/authorization");
  dialog.searchParams.set("response_type", "code");
  dialog.searchParams.set("client_id", clientId);
  dialog.searchParams.set("redirect_uri", redirectUri(request));
  dialog.searchParams.set("state", profileId);
  dialog.searchParams.set("scope", LINKEDIN_OAUTH_SCOPES);
  return NextResponse.redirect(dialog);
}
