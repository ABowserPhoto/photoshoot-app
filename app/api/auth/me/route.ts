import { NextResponse } from "next/server";

import type { User } from "@supabase/supabase-js";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { createSupabaseAuthRouteClient } from "@/lib/server/supabaseServer";

export const dynamic = "force-dynamic";

const UNAUTHENTICATED_BODY = {
  authenticated: false,
  role: null,
  isAdmin: false,
  accessibleModules: [],
};

/**
 * Returns the current auth role for nav/RBAC.
 * Supports Supabase session cookies and the workflow_gate password cookie.
 * Always returns HTTP 200 for unauthenticated callers (expected on /login).
 */
export async function GET() {
  const routeClient = await createSupabaseAuthRouteClient();

  let prefetchUser: User | null = null;
  if (routeClient) {
    const { data } = await routeClient.client.auth.getUser();
    prefetchUser = data.user ?? null;
  }

  const auth = await getAuthRole({
    supabaseClient: routeClient?.client ?? null,
    prefetchUser,
  });

  if (!auth.authenticated) {
    const response = NextResponse.json(UNAUTHENTICATED_BODY);
    return routeClient ? routeClient.applySessionCookies(response) : response;
  }

  const response = NextResponse.json({
    authenticated: true,
    role: auth.role,
    isAdmin: auth.isAdmin,
    accessibleModules: auth.accessibleModules,
  });

  return routeClient ? routeClient.applySessionCookies(response) : response;
}
