import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { validateScheduledAtOrError } from "@/lib/server/schedulerPostValidation";

export const dynamic = "force-dynamic";

type ScheduleUpdate = {
  postId?: unknown;
  scheduledAt?: unknown;
  caption?: unknown;
  absoluteIndex?: unknown;
};

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function deriveStatus(scheduledAt: Date | null): string {
  return scheduledAt ? "scheduled" : "pending";
}

export async function POST(request: NextRequest) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ScheduleUpdate | { updates?: ScheduleUpdate[] };
  try {
    body = (await request.json()) as ScheduleUpdate | { updates?: ScheduleUpdate[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates = Array.isArray((body as { updates?: ScheduleUpdate[] }).updates)
    ? (body as { updates: ScheduleUpdate[] }).updates
    : [body as ScheduleUpdate];

  if (updates.length === 0) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const normalized: Array<{
    postId: string;
    scheduledAt: Date | null;
    caption?: string | null;
    absoluteIndex?: number;
  }> = [];

  for (const update of updates) {
    const postId = typeof update.postId === "string" ? update.postId.trim() : "";
    if (!postId || postId.startsWith("temp-")) {
      return NextResponse.json({ error: "Valid postId is required." }, { status: 400 });
    }

    const validated = validateScheduledAtOrError(update.scheduledAt);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    let caption: string | null | undefined;
    if (update.caption !== undefined) {
      caption = typeof update.caption === "string" ? update.caption.trim() || null : null;
    }

    let absoluteIndex: number | undefined;
    if (update.absoluteIndex !== undefined) {
      const parsed = Number(update.absoluteIndex);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json({ error: "Invalid absoluteIndex." }, { status: 400 });
      }
      absoluteIndex = Math.round(parsed);
    }

    normalized.push({
      postId,
      scheduledAt: validated.scheduledAt,
      caption,
      absoluteIndex,
    });
  }

  for (const item of normalized) {
    const payload: Record<string, unknown> = {
      scheduled_at: item.scheduledAt ? item.scheduledAt.toISOString() : null,
      status: deriveStatus(item.scheduledAt),
    };
    if (item.caption !== undefined) {
      payload.caption = item.caption;
    }
    if (item.absoluteIndex !== undefined) {
      payload.absolute_index = item.absoluteIndex;
    }

    const { error } = await supabase.from("social_posts").update(payload).eq("id", item.postId);
    if (error) {
      console.error("[social/schedule]", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, updated: normalized.length });
}
