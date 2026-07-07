import { NextRequest, NextResponse } from "next/server";

import { makeServiceSupabase, publishDuePosts } from "@/lib/server/socialPublisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/publish-social
 *
 * Vercel Cron / external scheduler endpoint that publishes any social_posts
 * whose status = 'scheduled' and scheduled_at <= NOW().
 *
 * Security: callers must supply the correct CRON_SECRET value in one of:
 *   - Authorization: Bearer <secret>      (Vercel Cron default)
 *   - ?secret=<secret>                    (fallback for simple HTTP callers)
 *
 * Set CRON_SECRET in .env.local / Vercel project environment variables.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[cron/publish-social] CRON_SECRET is not configured.");
    return NextResponse.json({ error: "Cron endpoint is not configured." }, { status: 503 });
  }

  // Accept "Authorization: Bearer <secret>" (Vercel Cron injects this automatically)
  // or "?secret=<secret>" for other callers.
  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const querySecret = request.nextUrl.searchParams.get("secret")?.trim() ?? "";
  const suppliedSecret = bearerToken || querySecret;

  if (suppliedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = makeServiceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  try {
    const result = await publishDuePosts(supabase);

    console.info(
      `[cron/publish-social] Done — processed=${result.processed} successful=${result.successful} failed=${result.failed}`
    );

    return NextResponse.json({
      ok: true,
      processed: result.processed,
      successful: result.successful,
      failed: result.failed,
      outcomes: result.outcomes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/publish-social] Unhandled error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
