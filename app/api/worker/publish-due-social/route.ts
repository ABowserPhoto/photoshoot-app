import { NextResponse } from "next/server";

import { makeServiceSupabase, publishDuePosts } from "@/lib/server/socialPublisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/worker/publish-due-social
 *
 * Local processing-worker entry point that publishes due social_posts
 * (status = scheduled AND scheduled_at <= now).
 *
 * Auth: x-worker-secret must match LOCAL_WORKER_SECRET.
 * (Vercel Cron continues to use GET /api/cron/publish-social + CRON_SECRET.)
 */
export async function POST(request: Request) {
  const expected = process.env.LOCAL_WORKER_SECRET?.trim();
  const provided = request.headers.get("x-worker-secret")?.trim() ?? "";
  if (!expected || provided !== expected) {
    console.error("[worker/publish-due-social] Unauthorized worker request.");
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = makeServiceSupabase();
  if (!supabase) {
    console.error("[worker/publish-due-social] Supabase is not configured.");
    return NextResponse.json(
      { error: "Database is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  try {
    const result = await publishDuePosts(supabase);
    console.info(
      `[worker/publish-due-social] Done — processed=${result.processed} successful=${result.successful} failed=${result.failed}`
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
    console.error("[worker/publish-due-social] Unhandled error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
