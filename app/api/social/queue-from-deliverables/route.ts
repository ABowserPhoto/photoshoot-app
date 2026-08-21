import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { queueDeliverablesToSocialGrid } from "@/lib/server/socialGridQueue";
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

function isImageFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp")
  );
}

/**
 * Route B: upload social selections to the social_media bucket and insert
 * scheduled rows into social_posts for the category-mapped profile grid.
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const taskId = String(form.get("taskId") ?? "").trim();
  const photoshootType = String(form.get("photoshootType") ?? "").trim();
  const clientName = String(form.get("clientName") ?? "").trim();
  const shootLocation = String(form.get("shootLocation") ?? "").trim();
  const routePreview = resolveSocialCategoryRoute(photoshootType);

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required.", route: routePreview }, { status: 400 });
  }

  const files = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
    .filter(isImageFile);

  if (files.length === 0) {
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
    files,
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
