import { NextRequest, NextResponse } from "next/server";

import { assertSocialStaff } from "@/lib/server/assertSocialStaff";
import { listCachedPostEngagement } from "@/lib/server/cachedPostMetrics";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cached per-post counts for tiles. Never calls a platform API. */
export async function GET(request: NextRequest) {
  const auth = await assertSocialStaff();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() ?? "";
  if (!UUID_RE.test(clientId)) {
    return NextResponse.json({ posts: [] });
  }

  const result = await listCachedPostEngagement(clientId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ posts: result.posts });
}
