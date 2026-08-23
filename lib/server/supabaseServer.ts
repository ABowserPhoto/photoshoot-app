import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";
import { getSupabasePublicEnv, getSupabaseServiceRoleKey } from "@/lib/supabaseEnv";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function createServerClientWithCookieStore(
  cookieStore: CookieStore,
  pendingCookies: { current: Array<{ name: string; value: string; options: CookieOptions }> }
): SupabaseClient | null {
  const { url, anonKey } = getSupabasePublicEnv();
  if (!url || !anonKey) {
    return null;
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        pendingCookies.current = cookiesToSet;
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Route handlers may not allow cookieStore.set — flush via applySessionCookies().
        }
      },
    },
  });
}

/**
 * Supabase SSR client bound to the request cookie jar (session JWT for RLS).
 */
export async function createCookieAuthServerClient(): Promise<SupabaseClient | null> {
  const cookieStore: CookieStore = await cookies();
  const pendingCookies = { current: [] as Array<{ name: string; value: string; options: CookieOptions }> };
  return createServerClientWithCookieStore(cookieStore, pendingCookies);
}

export type SupabaseAuthRouteClient = {
  client: SupabaseClient;
  applySessionCookies: (response: NextResponse) => NextResponse;
};

/**
 * Route-handler client that can refresh the Supabase session and attach updated auth cookies to the response.
 */
export async function createSupabaseAuthRouteClient(): Promise<SupabaseAuthRouteClient | null> {
  const cookieStore: CookieStore = await cookies();
  const pendingCookies = {
    current: [] as Array<{ name: string; value: string; options: CookieOptions }>,
  };
  const client = createServerClientWithCookieStore(cookieStore, pendingCookies);
  if (!client) {
    return null;
  }

  return {
    client,
    applySessionCookies(response) {
      pendingCookies.current.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
      return response;
    },
  };
}

export function createServiceRoleClient(fetchTimeoutMs?: number): SupabaseClient | null {
  const { url } = getSupabasePublicEnv();
  const serviceKey = getSupabaseServiceRoleKey();
  if (!url || !serviceKey) {
    return null;
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
    global:
      typeof fetchTimeoutMs === "number"
        ? {
            fetch: (input, init) => fetchWithTimeout(input, init, fetchTimeoutMs),
          }
        : undefined,
  });
}

export type RouteSupabaseClient = {
  client: SupabaseClient;
  mode: "service" | "session";
};

/**
 * Trusted API routes: prefer service_role (bypasses RLS), else cookie session (RLS as user).
 * Avoids bare anon reads that return empty lists under strict RLS.
 */
export async function createRouteSupabaseClient(
  fetchTimeoutMs?: number
): Promise<RouteSupabaseClient | null> {
  const serviceClient = createServiceRoleClient(fetchTimeoutMs);
  if (serviceClient) {
    return { client: serviceClient, mode: "service" };
  }

  const sessionClient = await createCookieAuthServerClient();
  if (sessionClient) {
    return { client: sessionClient, mode: "session" };
  }

  return null;
}

export async function getSessionUser() {
  const supabase = await createCookieAuthServerClient();
  if (!supabase) {
    return null;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
