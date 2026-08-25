import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildSocialCaptionSeed,
  profileMatchesRoute,
  resolveSocialCategoryRoute,
  type SocialCategoryRoute,
} from "@/lib/socialCategoryRouting";

export type QueuedSocialPost = {
  id: string;
  profileId: string;
  handle: string;
  fileUrl: string;
  absoluteIndex: number;
  scheduledAt: string | null;
  status: string;
};

type SocialRuleRow = {
  start_date: string | null;
  posts_per_week: number | null;
  valid_days: unknown;
  start_time: string | null;
  end_time: string | null;
  min_interval_hours: number | null;
};

type SocialProfileMatch = {
  id: string;
  handle: string;
  clientName: string;
};

function asDayNumbers(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    return [1, 2, 3, 4, 5];
  }
  return raw
    .map((value) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.round(value);
      }
      if (typeof value !== "string") {
        return null;
      }
      const token = value.trim().toLowerCase();
      const map: Record<string, number> = {
        m: 1,
        mon: 1,
        monday: 1,
        t: 2,
        tue: 2,
        tuesday: 2,
        w: 3,
        wed: 3,
        wednesday: 3,
        th: 4,
        thu: 4,
        thursday: 4,
        f: 5,
        fri: 5,
        friday: 5,
        sa: 6,
        sat: 6,
        saturday: 6,
        su: 0,
        sun: 0,
        sunday: 0,
      };
      if (token in map) {
        return map[token];
      }
      const asNum = Number(token);
      return Number.isFinite(asNum) ? Math.round(asNum) : null;
    })
    .filter((value): value is number => value != null && value >= 0 && value <= 6);
}

function toMinutes(hhmm: string): number {
  const [hRaw, mRaw] = hhmm.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return 10 * 60;
  }
  return Math.max(0, Math.min(23 * 60 + 59, h * 60 + m));
}

/** Assign future scheduled times for newly appended grid slots using profile rules. */
export function computeScheduledAtsForNewSlots(
  count: number,
  rule: SocialRuleRow | null,
  existingScheduledAts: Array<string | null>
): Array<string | null> {
  if (count <= 0) {
    return [];
  }

  const validDays = asDayNumbers(rule?.valid_days);
  const startMinutes = toMinutes(rule?.start_time ?? "10:00");
  const endMinutes = Math.max(toMinutes(rule?.end_time ?? "19:00"), startMinutes + 1);
  const intervalMs = Math.max(1, rule?.min_interval_hours ?? 24) * 60 * 60 * 1000;
  const postsPerWeek = Math.min(Math.max(1, rule?.posts_per_week ?? 3), Math.max(1, validDays.length));

  const startAnchor = rule?.start_date ? new Date(`${rule.start_date}T00:00:00`) : new Date();
  if (Number.isNaN(startAnchor.getTime())) {
    startAnchor.setTime(Date.now());
  }

  const firstWeekStart = new Date(startAnchor);
  const mondayOffset = (firstWeekStart.getDay() + 6) % 7;
  firstWeekStart.setDate(firstWeekStart.getDate() - mondayOffset);
  firstWeekStart.setHours(0, 0, 0, 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const previousTimes = existingScheduledAts
    .map((value) => (value ? new Date(value) : null))
    .filter((value): value is Date => Boolean(value && !Number.isNaN(value.getTime())))
    .sort((a, b) => a.getTime() - b.getTime());
  let previousScheduled = previousTimes.length > 0 ? previousTimes[previousTimes.length - 1] : null;

  const weekdayOffsets = validDays.map((day) => (day + 6) % 7);
  const results: Array<string | null> = [];
  let weekOffset = 0;
  let pickedThisWeek = 0;

  while (results.length < count && weekOffset < 104) {
    const weekStart = new Date(firstWeekStart);
    weekStart.setDate(firstWeekStart.getDate() + weekOffset * 7);

    const weekCandidates = weekdayOffsets
      .map((offset) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + offset);
        date.setHours(0, 0, 0, 0);
        return date;
      })
      .filter((date) => date.getTime() >= Math.max(startAnchor.getTime(), todayStart.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    for (const day of weekCandidates) {
      if (pickedThisWeek >= postsPerWeek) {
        break;
      }
      if (results.length >= count) {
        break;
      }

      let dayStart = new Date(day);
      dayStart.setMinutes(startMinutes, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setMinutes(endMinutes, 0, 0);

      if (previousScheduled) {
        const minNext = new Date(previousScheduled.getTime() + intervalMs);
        if (dayStart.getTime() < minNext.getTime()) {
          dayStart = minNext;
        }
      }

      if (dayStart.getTime() > dayEnd.getTime()) {
        continue;
      }

      results.push(dayStart.toISOString());
      previousScheduled = dayStart;
      pickedThisWeek += 1;
    }

    weekOffset += 1;
    pickedThisWeek = 0;
  }

  while (results.length < count) {
    results.push(null);
  }
  return results;
}

export async function resolveProfileForCategory(
  supabase: SupabaseClient,
  photoshootType: string
): Promise<{ route: SocialCategoryRoute; profile: SocialProfileMatch } | { route: SocialCategoryRoute; error: string }> {
  const route = resolveSocialCategoryRoute(photoshootType);

  const { data, error } = await supabase
    .from("social_profiles")
    .select("id, handle, platform, client_id, social_clients(name)")
    .order("created_at", { ascending: true });

  if (error) {
    return { route, error: `Could not load social profiles: ${error.message}` };
  }

  const profiles: SocialProfileMatch[] = (data ?? [])
    .filter((row) => {
      const platform = typeof row.platform === "string" ? row.platform.trim().toLowerCase() : "";
      return !platform || platform === "instagram";
    })
    .map((row) => {
      const clientJoin = row.social_clients as { name?: string } | { name?: string }[] | null;
      const clientName = Array.isArray(clientJoin)
        ? (clientJoin[0]?.name ?? "")
        : (clientJoin?.name ?? "");
      return {
        id: String(row.id),
        handle: typeof row.handle === "string" ? row.handle : "",
        clientName,
      };
    });

  const preferred =
    profiles.find((profile) => profileMatchesRoute(route, profile) && Boolean(profile.handle)) ??
    profiles.find((profile) => profileMatchesRoute(route, profile));

  if (!preferred) {
    return {
      route,
      error: `No social profile matched category "${route.categoryLabel}". Link a profile handle such as ${route.handleTokens[0]}.`,
    };
  }

  return { route, profile: preferred };
}

export async function queueDeliverablesToSocialGrid(input: {
  supabase: SupabaseClient;
  photoshootType: string;
  clientName: string;
  shootLocation: string;
  /** Public URLs in the social_media bucket (uploaded client-side). */
  fileUrls: string[];
  taskId: string;
}): Promise<{ ok: true; posts: QueuedSocialPost[]; route: SocialCategoryRoute; handle: string } | { ok: false; error: string; route: SocialCategoryRoute }> {
  const resolved = await resolveProfileForCategory(input.supabase, input.photoshootType);
  if ("error" in resolved) {
    return { ok: false, error: resolved.error, route: resolved.route };
  }

  const { route, profile } = resolved;
  if (input.fileUrls.length === 0) {
    return { ok: true, posts: [], route, handle: profile.handle };
  }

  const { data: existingPosts, error: postsError } = await input.supabase
    .from("social_posts")
    .select("absolute_index, scheduled_at")
    .eq("profile_id", profile.id)
    .order("absolute_index", { ascending: true });

  if (postsError) {
    return { ok: false, error: `Could not load existing social grid: ${postsError.message}`, route };
  }

  const occupied = new Set(
    (existingPosts ?? [])
      .map((row) => Number(row.absolute_index))
      .filter((value) => Number.isInteger(value) && value >= 0)
  );
  const existingScheduledAts = (existingPosts ?? []).map((row) =>
    typeof row.scheduled_at === "string" ? row.scheduled_at : null
  );

  const { data: ruleRow } = await input.supabase
    .from("social_rules")
    .select("start_date, posts_per_week, valid_days, start_time, end_time, min_interval_hours")
    .eq("profile_id", profile.id)
    .maybeSingle();

  const scheduledAts = computeScheduledAtsForNewSlots(
    input.fileUrls.length,
    (ruleRow as SocialRuleRow | null) ?? null,
    existingScheduledAts
  );

  const nextIndexes: number[] = [];
  let cursor = 0;
  while (nextIndexes.length < input.fileUrls.length) {
    if (!occupied.has(cursor)) {
      nextIndexes.push(cursor);
    }
    cursor += 1;
  }

  const captionSeed = buildSocialCaptionSeed({
    clientName: input.clientName,
    shootLocation: input.shootLocation,
    photoshootType: input.photoshootType,
  });

  const queued: QueuedSocialPost[] = [];

  for (let i = 0; i < input.fileUrls.length; i += 1) {
    const fileUrl = input.fileUrls[i].trim();
    const absoluteIndex = nextIndexes[i];
    const scheduledAt = scheduledAts[i];
    const status = scheduledAt ? "scheduled" : "pending";

    const insertPayload = {
      profile_id: profile.id,
      absolute_index: absoluteIndex,
      file_url: fileUrl,
      caption: captionSeed,
      scheduled_at: scheduledAt,
      status,
      is_custom_schedule: false,
      post_type: "FEED",
    };

    let inserted = await input.supabase.from("social_posts").insert(insertPayload).select("id").single();
    if (inserted.error && /post_type|column|schema|Could not find/i.test(inserted.error.message)) {
      const { post_type: _postType, ...withoutPostType } = insertPayload;
      inserted = await input.supabase.from("social_posts").insert(withoutPostType).select("id").single();
    }

    if (inserted.error || !inserted.data) {
      return {
        ok: false,
        error: `Could not create social_posts row: ${inserted.error?.message ?? "empty response"}`,
        route,
      };
    }

    queued.push({
      id: String(inserted.data.id),
      profileId: profile.id,
      handle: profile.handle,
      fileUrl,
      absoluteIndex,
      scheduledAt,
      status,
    });
  }

  return { ok: true, posts: queued, route, handle: profile.handle };
}
