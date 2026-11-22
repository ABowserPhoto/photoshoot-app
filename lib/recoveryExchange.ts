import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabasePublicEnv } from "@/lib/supabaseEnv";
import { isPasswordResetPath, recoveryLandingUrl } from "@/lib/passwordReset";

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

/**
 * Recovery emails land on `/reset-password?code=...` on the host that requested
 * the email. Exchange the PKCE code here, where the session cookie can be
 * written, then redirect to that same URL without the code.
 */
export async function redirectAfterRecoveryExchange(request: NextRequest): Promise<NextResponse | null> {
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !isPasswordResetPath(request.nextUrl.pathname)) return null;

  const { url: supabaseUrl, anonKey: supabaseAnonKey } = getSupabasePublicEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(recoveryLandingUrl(request.nextUrl, "invalid"));
  }

  const pending: PendingCookie[] = [];
  const responseHeaders: Record<string, string> = {};

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        cookiesToSet.forEach((cookie) => {
          const index = pending.findIndex((item) => item.name === cookie.name);
          if (index === -1) pending.push(cookie);
          else pending[index] = cookie;
        });
        Object.assign(responseHeaders, headers);
      },
    },
  });

  let failed = false;
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
    if (error) console.error("[password-reset] Recovery code exchange failed.");
  } catch {
    console.error("[password-reset] Recovery code exchange failed.");
    failed = true;
  }

  const redirectResponse = NextResponse.redirect(
    recoveryLandingUrl(request.nextUrl, failed ? "invalid" : "ready")
  );
  pending.forEach(({ name, value, options }) => {
    redirectResponse.cookies.set(name, value, options);
  });
  Object.entries(responseHeaders).forEach(([key, value]) => {
    redirectResponse.headers.set(key, value);
  });
  return redirectResponse;
}
