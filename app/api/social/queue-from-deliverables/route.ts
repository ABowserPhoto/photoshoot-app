import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { queueDeliverablesToSocialGrid } from "@/lib/server/socialGridQueue";
import { isTaskSocialMediaFileUrl } from "@/lib/socialMediaStorage";
import { resolveSocialCategoryRoute } from "@/lib/socialCategoryRouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return null;
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

type QueueFromDeliverablesBody = {
  taskId?: unknown;
  photoshootType?: unknown;
  clientName?: unknown;
  shootLocation?: unknown;
  fileUrls?: unknown;
};

/**
 * Route B: register client-uploaded social_media URLs and insert scheduled rows
 * into social_posts for the category-mapped profile grid.
 *
 * Files must be uploaded to Supabase Storage from the browser first — this route
 * accepts URL strings only to stay under Vercel's serverless body limit.
 */
export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required to queue social posts." },
      { status: 503 }
    );
  }

  let body: QueueFromDeliverablesBody;
  try {
    body = (await request.json()) as QueueFromDeliverablesBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const photoshootType = typeof body.photoshootType === "string" ? body.photoshootType.trim() : "";
  const clientName = typeof body.clientName === "string" ? body.clientName.trim() : "";
  const shootLocation = typeof body.shootLocation === "string" ? body.shootLocation.trim() : "";
  const routePreview = resolveSocialCategoryRoute(photoshootType);

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required.", route: routePreview }, { status: 400 });
  }

  const rawUrls = Array.isArray(body.fileUrls) ? body.fileUrls : [];
  const fileUrls = rawUrls
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const invalidUrl = fileUrls.find((url) => !isTaskSocialMediaFileUrl(url, taskId));
  if (invalidUrl) {
    return NextResponse.json(
      {
        success: false,
        error: "Each fileUrl must be a social_media object URL for this task.",
        route: routePreview,
      },
      { status: 400 }
    );
  }

  if (fileUrls.length === 0) {
    return NextResponse.json({
      success: true,
      skipped: true,
      message: "No social images selected — Drive upload can proceed without social scheduling.",
      posts: [],
      route: routePreview,
    });
  }

  const result = await queueDeliverablesToSocialGrid({
    supabase,
    photoshootType,
    clientName,
    shootLocation,
    fileUrls,
    taskId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error, route: result.route },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    posts: result.posts,
    handle: result.handle,
    route: result.route,
    message: `Queued ${result.posts.length} post(s) for @${result.handle}.`,
  });
}
