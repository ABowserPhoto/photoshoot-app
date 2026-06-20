import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { deriveGateToken, timingSafeEqualHex } from "@/lib/gateToken";

const GATE_COOKIE = "workflow_gate";

function isMetadataAdmin(user: User): boolean {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const rawRole = meta?.role;
  return String(rawRole ?? "")
    .trim()
    .toLowerCase() === "admin";
}

async function getGatekeeperAdminAuth(): Promise<{ authenticated: boolean; isAdmin: boolean } | null> {
  const cookieStore = await cookies();
  const secret = process.env.APP_AUTH_SECRET?.trim();
  const adminPassword = process.env.APP_ADMIN_PASSWORD?.trim();
  const editorPassword = process.env.APP_EDITOR_PASSWORD?.trim();
  const cookieVal = cookieStore.get(GATE_COOKIE)?.value;

  if (!secret || !adminPassword || !editorPassword || !cookieVal) {
    return null;
  }

  const adminExpected = await deriveGateToken(secret, adminPassword);
  if (timingSafeEqualHex(cookieVal, adminExpected)) {
    return { authenticated: true, isAdmin: true };
  }

  const editorExpected = await deriveGateToken(secret, editorPassword);
  if (timingSafeEqualHex(cookieVal, editorExpected)) {
    return { authenticated: true, isAdmin: false };
  }

  return null;
}

/**
 * Admin-area access: Supabase users must have user_metadata.role === "admin".
 * Gatekeeper cookie admins (no Supabase session) remain allowed for legacy access.
 */
export async function getAdminAreaAuth(): Promise<{ authenticated: boolean; isAdmin: boolean }> {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Cookie writes can fail in non-mutable contexts; session read still works.
          }
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      return { authenticated: true, isAdmin: isMetadataAdmin(user) };
    }
  }

  const gatekeeperAuth = await getGatekeeperAdminAuth();
  if (gatekeeperAuth) {
    return gatekeeperAuth;
  }

  return { authenticated: false, isAdmin: false };
}
