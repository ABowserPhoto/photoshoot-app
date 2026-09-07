import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveOpenShiftClose, resolveUserClockOut } from "@/lib/shiftCaps";

type OpenShiftRow = {
  id: string;
  clock_in_at: string;
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

export async function persistOpenShiftClose(
  sb: SupabaseClient,
  shiftId: string,
  clockInAt: string,
  now = new Date(),
  mode: "stale" | "user" = "stale"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const close = mode === "user" ? resolveUserClockOut(clockInAt, now) : resolveOpenShiftClose(clockInAt, now);
  const { error } = await sb
    .from("user_shifts")
    .update({
      clock_out_at: close.clockOutAt.toISOString(),
      duration_minutes: close.durationMinutes,
    })
    .eq("id", shiftId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Force-close open shifts that crossed the 12h / midnight backstop.
 * Internal helper — callers must already be authorized.
 */
export async function closeStaleOpenShiftsInternal(options?: {
  userId?: string;
}): Promise<{ ok: true; closed: number } | { ok: false; error: string }> {
  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  let query = sb.from("user_shifts").select("id, clock_in_at").is("clock_out_at", null);
  if (options?.userId?.trim()) {
    query = query.eq("user_id", options.userId.trim());
  }

  const { data, error } = await query;
  if (error) {
    console.error("[closeStaleOpenShifts]", error);
    return { ok: false, error: error.message };
  }

  const now = new Date();
  let closed = 0;
  for (const shift of (data ?? []) as OpenShiftRow[]) {
    const clockInAt = String(shift.clock_in_at ?? "");
    const close = resolveOpenShiftClose(clockInAt, now);
    if (!close.isStale) {
      continue;
    }
    const persisted = await persistOpenShiftClose(sb, shift.id, clockInAt, now);
    if (!persisted.ok) {
      return persisted;
    }
    closed += 1;
  }

  return { ok: true, closed };
}

export function getShiftServiceSupabase() {
  return serviceSupabase();
}
