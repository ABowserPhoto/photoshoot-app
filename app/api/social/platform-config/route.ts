import { NextResponse } from "next/server";

import { assertSocialStaff } from "@/lib/server/assertSocialStaff";
import { socialPlatformCredentials } from "@/lib/server/socialPlatformConfig";

export const dynamic = "force-dynamic";

/** Booleans only. Client ids and secrets stay on the server. */
export async function GET() {
  const auth = await assertSocialStaff();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(socialPlatformCredentials());
}
