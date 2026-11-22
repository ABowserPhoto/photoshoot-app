import { NextRequest, NextResponse } from "next/server";

import { assertSocialStaff } from "@/lib/server/assertSocialStaff";
import { metaClientId, publicAppOrigin } from "@/lib/server/socialPlatformConfig";
import { META_OAUTH_SCOPES } from "@/lib/socialOAuthScopes";

export const dynamic = "force-dynamic";

function redirectUri(request: NextRequest): string {
  const fromEnv = process.env.META_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  return `${publicAppOrigin(request.nextUrl.origin)}/api/auth/meta`;
}

function schedulerError(request: NextRequest, message: string) {
  const target = new URL("/scheduler", `${publicAppOrigin(request.nextUrl.origin)}/`);
  target.searchParams.set("meta_error", message);
  return NextResponse.redirect(target);
}

/** Starts Meta OAuth using the server client id so the browser never needs the secret. */
export async function GET(request: NextRequest) {
  const auth = await assertSocialStaff();
  if (!auth.ok) {
    return schedulerError(request, "not_authenticated");
  }

  const profileId = request.nextUrl.searchParams.get("profileId")?.trim() ?? "";
  if (!profileId) {
    return schedulerError(request, "missing_profile_id");
  }

  const clientId = metaClientId();
  if (!clientId) {
    return schedulerError(request, "server_missing_meta_client_id");
  }

  const dialog = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  dialog.searchParams.set("client_id", clientId);
  dialog.searchParams.set("redirect_uri", redirectUri(request));
  dialog.searchParams.set("state", profileId);
  dialog.searchParams.set("scope", META_OAUTH_SCOPES);
  dialog.searchParams.set("response_type", "code");
  dialog.searchParams.set("auth_type", "rerequest");
  dialog.searchParams.set("prompt", "consent");
  return NextResponse.redirect(dialog);
}
