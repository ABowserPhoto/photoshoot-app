import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

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
      return supabaseResponse;
    }
  }

  const secret = process.env.APP_AUTH_SECRET?.trim();
  const adminPassword = process.env.APP_ADMIN_PASSWORD?.trim();
  const editorPassword = process.env.APP_EDITOR_PASSWORD?.trim();
  const cookieVal = request.cookies.get(GATE_COOKIE)?.value;

  if (secret && adminPassword && editorPassword && cookieVal) {
    const adminExpected = await deriveGateToken(secret, adminPassword);
    const editorExpected = await deriveGateToken(secret, editorPassword);
    if (timingSafeEqualHex(cookieVal, adminExpected) || timingSafeEqualHex(cookieVal, editorExpected)) {
      return supabaseResponse;
    }
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);

  const redirectResponse = NextResponse.redirect(loginUrl);
  return mergeSupabaseCookies(supabaseResponse, redirectResponse);
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
