import { NextResponse } from "next/server";

import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAdminAreaAuth();

  if (!auth.authenticated) {
    return NextResponse.json({ allowed: false, authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    allowed: auth.isAdmin,
    authenticated: true,
  });
}
