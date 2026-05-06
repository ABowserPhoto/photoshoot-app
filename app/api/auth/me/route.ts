import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthRole();

  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized", authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    role: auth.role,
    isAdmin: auth.isAdmin,
  });
}
