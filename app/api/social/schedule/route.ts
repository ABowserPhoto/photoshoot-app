import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { publishToInstagram } from "@/app/actions/publish-instagram";
import {
  canUseMetaNativeSchedule,
  normalizeInstagramPostType,
  validateMediaForPostType,
  type InstagramPostType,
} from "@/lib/instagramMedia";
import { getAuthRole } from "@/lib/server/getAuthRole";
import { validateScheduledAtOrError } from "@/lib/server/schedulerPostValidation";
import { getProfileInstagramCredentials } from "@/lib/server/socialPublisher";

export const dynamic = "force-dynamic";

type ScheduleUpdate = {
  postId?: unknown;
  scheduledAt?: unknown;
  caption?: unknown;
  absoluteIndex?: unknown;
  /** When true, scheduled_at was set manually and auto-schedule should leave it alone. */
  isCustomSchedule?: unknown;
  postType?: unknown;
};

type ScheduleOutcome = {
  postId: string;
  status: string;
  scheduledAt: string | null;
  postType: InstagramPostType;
  scheduleMode: "meta" | "local" | "none";
  metaCreationId?: string | null;
  metaScheduleError?: string | null;
  message?: string;
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

function deriveLocalStatus(scheduledAt: Date | null): string {
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
    isCustomSchedule?: boolean;
    postType?: InstagramPostType;
  }> = [];

  for (const update of updates) {
    const postId = typeof update.postId === "string" ? update.postId.trim() : "";
    if (!postId || postId.startsWith("temp-")) {
      console.error("[social/schedule] Rejected update: missing/temp postId", update);
      return NextResponse.json({ error: "Valid postId is required." }, { status: 400 });
    }

    const validated = validateScheduledAtOrError(update.scheduledAt);
    if (!validated.ok) {
      console.error(
        `[social/schedule] Schedule validation failed for post ${postId}:`,
        validated.error,
        "raw=",
        update.scheduledAt
      );
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

    let isCustomSchedule: boolean | undefined;
    if (update.isCustomSchedule !== undefined) {
      isCustomSchedule = Boolean(update.isCustomSchedule);
    }

    let postType: InstagramPostType | undefined;
    if (update.postType !== undefined) {
      postType = normalizeInstagramPostType(update.postType);
    }

    normalized.push({
      postId,
      scheduledAt: validated.scheduledAt,
      caption,
      absoluteIndex,
      isCustomSchedule,
      postType,
    });
  }

  const outcomes: ScheduleOutcome[] = [];

  for (const item of normalized) {
    type ExistingPost = {
      id: string;
      profile_id: string;
      file_url: string | null;
      caption: string | null;
      post_type?: string | null;
      status?: string | null;
      meta_creation_id?: string | null;
    };

    let existing: ExistingPost | null = null;
    {
      const { data, error: existingError } = await supabase
        .from("social_posts")
        .select("id, profile_id, file_url, caption, post_type, status, meta_creation_id")
        .eq("id", item.postId)
        .maybeSingle();

      if (existingError) {
        // Retry without newer columns on older schemas.
        if (/post_type|meta_creation_id|column|schema|Could not find/i.test(existingError.message ?? "")) {
          const retry = await supabase
            .from("social_posts")
            .select("id, profile_id, file_url, caption, status")
            .eq("id", item.postId)
            .maybeSingle();
          if (retry.error || !retry.data) {
            return NextResponse.json(
              { error: retry.error?.message ?? `Post not found: ${item.postId}` },
              { status: retry.error ? 400 : 404 }
            );
          }
          existing = retry.data as ExistingPost;
        } else {
          console.error("[social/schedule] Failed to load post", item.postId, existingError);
          return NextResponse.json({ error: existingError.message }, { status: 400 });
        }
      } else {
        existing = data as ExistingPost | null;
      }
    }

    if (!existing) {
      return NextResponse.json({ error: `Post not found: ${item.postId}` }, { status: 404 });
    }

    const postType = item.postType ?? normalizeInstagramPostType(existing.post_type);
    const fileUrl = typeof existing.file_url === "string" ? existing.file_url.trim() : "";
    const caption =
      item.caption !== undefined
        ? item.caption
        : typeof existing.caption === "string"
          ? existing.caption
          : null;

    if (item.scheduledAt && fileUrl) {
      const mediaError = validateMediaForPostType(postType, fileUrl);
      if (mediaError) {
        return NextResponse.json({ error: mediaError }, { status: 400 });
      }
    }

    const payload: Record<string, unknown> = {
      scheduled_at: item.scheduledAt ? item.scheduledAt.toISOString() : null,
      status: deriveLocalStatus(item.scheduledAt),
      // Clear Meta ownership whenever the schedule is rewritten; may be set again below.
      meta_creation_id: null,
      publish_error: null,
      post_type: postType,
    };
    if (item.caption !== undefined) {
      payload.caption = item.caption;
    }
    if (item.absoluteIndex !== undefined) {
      payload.absolute_index = item.absoluteIndex;
    }
    if (item.isCustomSchedule !== undefined) {
      payload.is_custom_schedule = item.isCustomSchedule;
    }

    let updatedRow: {
      id: string;
      status: string;
      scheduled_at: string | null;
      post_type?: string | null;
      meta_creation_id?: string | null;
      is_custom_schedule?: boolean | null;
    } | null = null;

    {
      const { data, error } = await supabase
        .from("social_posts")
        .update(payload)
        .eq("id", item.postId)
        .select("id, status, scheduled_at, post_type, meta_creation_id, is_custom_schedule")
        .maybeSingle();

      if (error) {
        // Strip newer columns and retry for older DBs.
        const stripped = { ...payload };
        delete stripped.post_type;
        delete stripped.meta_creation_id;
        if (
          item.isCustomSchedule !== undefined &&
          /is_custom_schedule|column|schema|Could not find/i.test(error.message ?? "")
        ) {
          delete stripped.is_custom_schedule;
        }
        if (/post_type|meta_creation_id|is_custom_schedule|column|schema|Could not find/i.test(error.message ?? "")) {
          const retry = await supabase
            .from("social_posts")
            .update(stripped)
            .eq("id", item.postId)
            .select("id, status, scheduled_at")
            .maybeSingle();
          if (retry.error) {
            console.error("[social/schedule] DB update failed for", item.postId, retry.error);
            return NextResponse.json({ error: retry.error.message }, { status: 400 });
          }
          if (!retry.data) {
            return NextResponse.json({ error: `Post not found: ${item.postId}` }, { status: 404 });
          }
          updatedRow = retry.data;
        } else {
          console.error("[social/schedule] DB update failed for", item.postId, error);
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
      } else {
        if (!data) {
          return NextResponse.json({ error: `Post not found: ${item.postId}` }, { status: 404 });
        }
        updatedRow = data;
      }
    }

    let scheduleMode: ScheduleOutcome["scheduleMode"] = item.scheduledAt ? "local" : "none";
    let metaCreationId: string | null = null;
    let metaScheduleError: string | null = null;
    let message: string | undefined;

    if (item.scheduledAt) {
      const eligibility = canUseMetaNativeSchedule(item.scheduledAt, postType);
      if (!eligibility.ok) {
        scheduleMode = "local";
        message = eligibility.reason;
        console.info(
          `[social/schedule] Local fallback for ${item.postId}: ${eligibility.reason}`
        );
      } else {
        const credentials = await getProfileInstagramCredentials(
          supabase,
          String(existing.profile_id)
        );
        if (!credentials) {
          scheduleMode = "local";
          message =
            "No Instagram credentials on this profile; using local worker fallback.";
          console.warn(`[social/schedule] ${message} post=${item.postId}`);
        } else {
          const metaResult = await publishToInstagram({
            igAccountId: credentials.igAccountId,
            accessToken: credentials.accessToken,
            mediaUrl: fileUrl,
            caption: caption ?? "",
            postType,
            scheduledPublishTimeUnix: eligibility.unixSeconds,
          });

          if (metaResult.ok && metaResult.scheduled) {
            const { error: metaUpdateError } = await supabase
              .from("social_posts")
              .update({
                status: "scheduled_with_meta",
                meta_creation_id: metaResult.creationId,
                publish_error: null,
              })
              .eq("id", item.postId);

            if (metaUpdateError) {
              console.error(
                "[social/schedule] Meta schedule succeeded but DB update failed:",
                metaUpdateError.message,
                { postId: item.postId, creationId: metaResult.creationId }
              );
              // Keep local scheduled so the worker can still publish.
              scheduleMode = "local";
              metaScheduleError = metaUpdateError.message;
              message =
                "Meta accepted the schedule, but saving creation_id failed — keeping local worker fallback.";
            } else {
              scheduleMode = "meta";
              metaCreationId = metaResult.creationId;
              message = "Scheduled with Instagram (Meta). Local worker will ignore this post.";
              updatedRow = {
                ...(updatedRow as NonNullable<typeof updatedRow>),
                status: "scheduled_with_meta",
                meta_creation_id: metaResult.creationId,
              };
              console.info(
                `[social/schedule] Meta native schedule OK post=${item.postId} creation_id=${metaResult.creationId} unix=${eligibility.unixSeconds}`
              );
            }
          } else {
            scheduleMode = "local";
            metaScheduleError = metaResult.ok
              ? "Meta create did not return a scheduled container."
              : metaResult.error;
            const looksLikeScheduleParam =
              /scheduled_publish_time|whitelist|published/i.test(metaScheduleError ?? "");
            console.error(
              `[social/schedule] Meta native schedule failed; falling back to local worker.`,
              {
                postId: item.postId,
                postType,
                scheduledUnix: eligibility.unixSeconds,
                scheduledPublishTimeRelated: looksLikeScheduleParam,
                error: metaScheduleError,
                details: metaResult.ok ? undefined : metaResult.details,
              }
            );
            message = `Meta native schedule unavailable (${metaScheduleError}). Using local worker fallback.`;
          }
        }
      }
    }

    outcomes.push({
      postId: item.postId,
      status: updatedRow?.status ?? deriveLocalStatus(item.scheduledAt),
      scheduledAt: updatedRow?.scheduled_at ?? (item.scheduledAt ? item.scheduledAt.toISOString() : null),
      postType,
      scheduleMode,
      metaCreationId,
      metaScheduleError,
      message,
    });

    console.info(
      `[social/schedule] Updated post ${item.postId} → status=${outcomes[outcomes.length - 1]?.status} mode=${scheduleMode} type=${postType}`
    );
  }

  return NextResponse.json({ ok: true, updated: outcomes.length, outcomes });
}
