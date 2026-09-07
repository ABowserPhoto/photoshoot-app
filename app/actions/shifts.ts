"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import {
  closeStaleOpenShiftsInternal,
  getShiftServiceSupabase,
  persistOpenShiftClose,
} from "@/lib/server/closeStaleShifts";
import { getAuthRole } from "@/lib/server/getAuthRole";
import { durationMinutesFromRange } from "@/lib/shiftCaps";

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

type ShiftUpdateRow = {
  id: string;
  clock_in_at: string;
};

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

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getAuthRole();
  if (!auth.authenticated || !auth.isAdmin) {
    return { ok: false, error: "Forbidden" };
  }
  return { ok: true };
}

export async function syncOwnOpenShift(): Promise<{ ok: true; closed: number } | { ok: false; error: string }> {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return { ok: false, error: "Unauthorized" };
  }
  const sessionUserId = await getSessionUserId();
  if (!sessionUserId) {
    return { ok: true, closed: 0 };
  }
  return closeStaleOpenShiftsInternal({ userId: sessionUserId });
}

export async function handleClockIn(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const authCheck = await assertUserMatchesSession(userId);
  if (!authCheck.ok) {
    return authCheck;
  }

  const sb = getShiftServiceSupabase();
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

  for (const shift of (openShifts ?? []) as ShiftUpdateRow[]) {
    const persisted = await persistOpenShiftClose(sb, shift.id, String(shift.clock_in_at ?? ""), now);
    if (!persisted.ok) {
      console.error("[handleClockIn close orphan]", persisted.error);
      return persisted;
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

  const sb = getShiftServiceSupabase();
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

  const persisted = await persistOpenShiftClose(
    sb,
    String(activeShift.id),
    String(activeShift.clock_in_at ?? ""),
    now,
    "user"
  );
  if (!persisted.ok) {
    console.error("[handleClockOut update]", persisted.error);
    return persisted;
  }

  return { ok: true };
}

function parseIsoTimestamp(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export async function adminUpdateShift(
  shiftId: string,
  clockInAt: string,
  clockOutAt: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await assertAdmin();
  if (!admin.ok) {
    return admin;
  }

  const id = shiftId.trim();
  if (!id) {
    return { ok: false, error: "Shift id is required." };
  }

  const clockIn = parseIsoTimestamp(clockInAt);
  if (!clockIn) {
    return { ok: false, error: "Invalid clock-in time." };
  }

  let clockOut: Date | null = null;
  if (clockOutAt != null && clockOutAt.trim() !== "") {
    clockOut = parseIsoTimestamp(clockOutAt);
    if (!clockOut) {
      return { ok: false, error: "Invalid clock-out time." };
    }
    if (clockOut.getTime() <= clockIn.getTime()) {
      return { ok: false, error: "Clock-out must be after clock-in." };
    }
  }

  const sb = getShiftServiceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const { error } = await sb
    .from("user_shifts")
    .update({
      clock_in_at: clockIn.toISOString(),
      clock_out_at: clockOut ? clockOut.toISOString() : null,
      duration_minutes: clockOut ? durationMinutesFromRange(clockIn.toISOString(), clockOut) : null,
    })
    .eq("id", id);

  if (error) {
    console.error("[adminUpdateShift]", error);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function adminDeleteShifts(
  shiftIds: string[]
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const admin = await assertAdmin();
  if (!admin.ok) {
    return admin;
  }

  const ids = [...new Set(shiftIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return { ok: false, error: "No shifts selected." };
  }

  const sb = getShiftServiceSupabase();
  if (!sb) {
    return { ok: false, error: "Database is not configured." };
  }

  const { data, error } = await sb.from("user_shifts").delete().in("id", ids).select("id");
  if (error) {
    console.error("[adminDeleteShifts]", error);
    return { ok: false, error: error.message };
  }

  return { ok: true, deleted: data?.length ?? 0 };
}
