"use server";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";

/**
 * Expected Supabase table:
 *
 * user_shifts (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id uuid not null,
 *   clock_in_at timestamptz not null,
 *   clock_out_at timestamptz,
 *   duration_minutes integer,
 *   created_at timestamptz default now()
 * )
 */

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

function durationMinutes(clockInAt: string, clockOutAt: Date): number {
  const inMs = new Date(clockInAt).getTime();
  const outMs = clockOutAt.getTime();
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) {
    return 0;
  }
  return Math.round((outMs - inMs) / 60_000);
}

const ORPHAN_SHIFT_CAP_MINUTES = 720;
const ORPHAN_SHIFT_CAP_MS = ORPHAN_SHIFT_CAP_MINUTES * 60_000;

function resolveOrphanShiftClose(
  clockInAt: string,
  now: Date
): { clockOutAt: Date; durationMinutes: number } {
  const clockInMs = new Date(clockInAt).getTime();
  if (!Number.isFinite(clockInMs)) {
    return { clockOutAt: now, durationMinutes: 0 };
  }

  const elapsedMs = now.getTime() - clockInMs;
  if (elapsedMs > ORPHAN_SHIFT_CAP_MS) {
    return {
      clockOutAt: new Date(clockInMs + ORPHAN_SHIFT_CAP_MS),
      durationMinutes: ORPHAN_SHIFT_CAP_MINUTES,
    };
  }

  return {
    clockOutAt: now,
    durationMinutes: durationMinutes(clockInAt, now),
  };
}

async function getSessionUserId(): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Cookie writes can fail in non-mutable contexts; session read still works.
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

async function assertUserMatchesSession(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const sessionUserId = await getSessionUserId();
  const trimmed = userId.trim();
  if (!sessionUserId || sessionUserId !== trimmed) {
    return { ok: false, error: "Unauthorized" };
  }

  return { ok: true };
}

export async function handleClockIn(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const authCheck = await assertUserMatchesSession(userId);
  if (!authCheck.ok) {
    return authCheck;
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const trimmedUserId = userId.trim();
  const now = new Date();

  const { data: openShifts, error: openErr } = await sb
    .from("user_shifts")
    .select("id, clock_in_at")
    .eq("user_id", trimmedUserId)
    .is("clock_out_at", null);

  if (openErr) {
    console.error("[handleClockIn open shifts]", openErr);
    return { ok: false, error: openErr.message };
  }

  for (const shift of openShifts ?? []) {
    const clockInAt = String(shift.clock_in_at ?? "");
    const orphanClose = resolveOrphanShiftClose(clockInAt, now);
    const { error: closeErr } = await sb
      .from("user_shifts")
      .update({
        clock_out_at: orphanClose.clockOutAt.toISOString(),
        duration_minutes: orphanClose.durationMinutes,
      })
      .eq("id", shift.id);

    if (closeErr) {
      console.error("[handleClockIn close orphan]", closeErr);
      return { ok: false, error: closeErr.message };
    }
  }

  const { error: insertErr } = await sb.from("user_shifts").insert({
    user_id: trimmedUserId,
    clock_in_at: now.toISOString(),
  });

  if (insertErr) {
    console.error("[handleClockIn insert]", insertErr);
    return { ok: false, error: insertErr.message };
  }

  return { ok: true };
}

export async function handleClockOut(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const authCheck = await assertUserMatchesSession(userId);
  if (!authCheck.ok) {
    return authCheck;
  }

  const sb = serviceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const trimmedUserId = userId.trim();
  const now = new Date();

  const { data: activeShift, error: fetchErr } = await sb
    .from("user_shifts")
    .select("id, clock_in_at")
    .eq("user_id", trimmedUserId)
    .is("clock_out_at", null)
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchErr) {
    console.error("[handleClockOut fetch]", fetchErr);
    return { ok: false, error: fetchErr.message };
  }

  if (!activeShift) {
    return { ok: true };
  }

  const clockInAt = String(activeShift.clock_in_at ?? "");
  const { error: updateErr } = await sb
    .from("user_shifts")
    .update({
      clock_out_at: now.toISOString(),
      duration_minutes: durationMinutes(clockInAt, now),
    })
    .eq("id", activeShift.id);

  if (updateErr) {
    console.error("[handleClockOut update]", updateErr);
    return { ok: false, error: updateErr.message };
  }

  return { ok: true };
}
