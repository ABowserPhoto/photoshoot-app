import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import {
  canAccessPathname,
  DEFAULT_STAFF_MODULES,
  firstAccessibleHref,
  normalizeAccessibleModules,
  type AppModule,
} from "@/lib/appModules";
import { normalizeRole } from "@/lib/authRole";
import { deriveGateToken, timingSafeEqualHex } from "@/lib/gateToken";

const GATE_COOKIE = "workflow_gate";

function isPublicRoute(pathname: string): boolean {
  if (pathname === "/login") {
    return true;
  }
  if (pathname === "/gallery" || pathname.startsWith("/gallery/")) {
    return true;
  }
  return false;
}

function isStaticAsset(pathname: string): boolean {
  return /\.(?:webp|png|jpg|jpeg|gif|svg|ico|woff2?|txt|xml|json)$/i.test(pathname);
}

function mergeSupabaseCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach(({ name, value }) => {
    to.cookies.set(name, value);
  });
  return to;
}

async function resolveModuleAccess(params: {
  userId: string | null;
  gateIsAdmin: boolean | null;
}): Promise<{ isAdmin: boolean; accessibleModules: AppModule[]; isArchived: boolean }> {
  if (params.gateIsAdmin === true) {
    return { isAdmin: true, accessibleModules: [], isArchived: false };
  }
  if (params.gateIsAdmin === false) {
    return { isAdmin: false, accessibleModules: [...DEFAULT_STAFF_MODULES], isArchived: false };
  }

  if (!params.userId) {
    return { isAdmin: false, accessibleModules: [], isArchived: false };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return { isAdmin: false, accessibleModules: [...DEFAULT_STAFF_MODULES], isArchived: false };
  }

  try {
    const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await sb
      .from("profiles")
      .select("role, is_archived, accessible_modules")
      .eq("id", params.userId)
      .maybeSingle();

    if (error || !data) {
      return { isAdmin: false, accessibleModules: [...DEFAULT_STAFF_MODULES], isArchived: false };
    }

    const row = data as {
      role?: unknown;
      is_archived?: unknown;
      accessible_modules?: unknown;
    };
    if (row.is_archived === true) {
      return { isAdmin: false, accessibleModules: [], isArchived: true };
    }
    const role = normalizeRole(row.role);
    if (role === "admin") {
      return { isAdmin: true, accessibleModules: [], isArchived: false };
    }
    return {
      isAdmin: false,
      accessibleModules: normalizeAccessibleModules(row.accessible_modules),
      isArchived: false,
    };
  } catch {
    return { isAdmin: false, accessibleModules: [...DEFAULT_STAFF_MODULES], isArchived: false };
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  let supabaseResponse = NextResponse.next({
    request,
  });

  let authedUserId: string | null = null;
  let gateIsAdmin: boolean | null = null;

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      authedUserId = user.id;
    }
  }

  if (!authedUserId) {
    const secret = process.env.APP_AUTH_SECRET?.trim();
    const adminPassword = process.env.APP_ADMIN_PASSWORD?.trim();
    const editorPassword = process.env.APP_EDITOR_PASSWORD?.trim();
    const cookieVal = request.cookies.get(GATE_COOKIE)?.value;

    if (secret && adminPassword && editorPassword && cookieVal) {
      const adminExpected = await deriveGateToken(secret, adminPassword);
      const editorExpected = await deriveGateToken(secret, editorPassword);
      if (timingSafeEqualHex(cookieVal, adminExpected)) {
        gateIsAdmin = true;
      } else if (timingSafeEqualHex(cookieVal, editorExpected)) {
        gateIsAdmin = false;
      }
    }
  }

  if (!authedUserId && gateIsAdmin === null) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);

    const redirectResponse = NextResponse.redirect(loginUrl);
    return mergeSupabaseCookies(supabaseResponse, redirectResponse);
  }

  const access = await resolveModuleAccess({
    userId: authedUserId,
    gateIsAdmin,
  });

  if (access.isArchived) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const redirectResponse = NextResponse.redirect(loginUrl);
    return mergeSupabaseCookies(supabaseResponse, redirectResponse);
  }

  // Clock widget stays available even when Staff have zero module grants.
  if (pathname === "/desktop-widget" || pathname.startsWith("/desktop-widget/")) {
    return supabaseResponse;
  }

  const allowed = canAccessPathname({
    isAdmin: access.isAdmin,
    accessibleModules: access.accessibleModules,
    pathname,
    search: request.nextUrl.search,
  });

  if (!allowed) {
    const target = firstAccessibleHref({
      isAdmin: access.isAdmin,
      accessibleModules: access.accessibleModules,
    });
    const redirectUrl = request.nextUrl.clone();
    const [pathOnly, query = ""] = target.split("?");
    redirectUrl.pathname = pathOnly || "/desktop-widget";
    redirectUrl.search = query ? `?${query}` : "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    return mergeSupabaseCookies(supabaseResponse, redirectResponse);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
