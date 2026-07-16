"use server";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// ── Jibble API endpoints ───────────────────────────────────────────────────
const JIBBLE_TOKEN_URL = "https://identity.prod.jibble.io/connect/token";
const JIBBLE_TIME_ENTRIES_URL = "https://time-tracking.prod.jibble.io/v1/TimeEntries";

// ── Supabase helpers ───────────────────────────────────────────────────────

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getSessionUserId(): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // No-op for read-only context.
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function resolveJibbleEmployeeId(userId: string): Promise<string | null> {
  const sb = serviceSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("profiles")
    .select("jibble_employee_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) return null;

  const value = (data as { jibble_employee_id?: unknown } | null)?.jibble_employee_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ── Jibble auth ────────────────────────────────────────────────────────────

async function getJibbleAccessToken(): Promise<string> {
  const clientId = process.env.JIBBLE_CLIENT_ID?.trim();
  const clientSecret = process.env.JIBBLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing JIBBLE_CLIENT_ID or JIBBLE_CLIENT_SECRET.");
  }

  const response = await fetch(JIBBLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    cache: "no-store",
  });

  const json = (await response.json().catch(() => null)) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(
      json?.error_description ?? json?.error ?? `Jibble token failed (${response.status}).`
    );
  }

  const token = json?.access_token?.trim();
  if (!token) throw new Error("Jibble token response missing access_token.");
  return token;
}

// ── TimeEntries fetch ──────────────────────────────────────────────────────

type TimeEntry = {
  id: string;
  personId: string;
  type: string;         // "In" | "Out"
  startTime: string;
  endTime?: string | null;
};

/**
 * Fetches the most recent TimeEntries for `employeeId` and returns whether
 * the person currently has an open clock-in.
 *
 * Jibble models attendance as discrete "In" / "Out" entries (not a
 * start-end span), so the user is clocked in when the newest entry has
 * type === "In".
 */
async function fetchActiveTimeEntry(
  employeeId: string,
  accessToken: string
): Promise<{ isClockedIn: boolean; timeEntryId: string | null }> {
  // Request the 5 most recent entries for this person so we are resilient to
  // OData filter dialects that may not support all query operators.
  const url = new URL(JIBBLE_TIME_ENTRIES_URL);
  url.searchParams.set("$filter", `personId eq '${employeeId}'`);
  url.searchParams.set("$orderby", "startTime desc");
  url.searchParams.set("$top", "5");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Jibble TimeEntries request failed (${response.status}).`);
  }

  const raw = (await response.json().catch(() => null)) as unknown;

  // Jibble may return either a plain array or an OData envelope { value: [...] }.
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.value)
      ? ((raw as Record<string, unknown>).value as unknown[])
      : [];

  if (items.length === 0) {
    return { isClockedIn: false, timeEntryId: null };
  }

  // The first item is the most recent entry (ordered desc).
  const latest = items[0] as Record<string, unknown>;
  const entryType = typeof latest.type === "string" ? latest.type.trim().toLowerCase() : "";
  const hasOpenEndTime = latest.endTime === null || latest.endTime === undefined;

  // Clocked in if the latest entry is an "In" with no end time, OR simply type === "in".
  const isClockedIn = entryType === "in" && hasOpenEndTime;
  const timeEntryId = typeof latest.id === "string" ? latest.id : null;

  return { isClockedIn, timeEntryId };
}

// ── Public server action ───────────────────────────────────────────────────

export type JibbleSyncResult = {
  ok: boolean;
  isClockedIn: boolean;
  timeEntryId: string | null;
  /** Set when the user has no Jibble account linked — button stays as-is. */
  notLinked?: boolean;
  error?: string;
};

/**
 * Server action: pulls the current clock status directly from Jibble for
 * the authenticated user and returns it to the client.
 *
 * Called from `JibbleClockToggle` on mount to reconcile any drifts caused
 * by the user clocking in/out via the Jibble mobile app.
 *
 * Errors are surfaced in the return value (never thrown) so the client can
 * fail silently and keep displaying the last known localStorage state.
 */
export async function syncUserJibbleStatus(): Promise<JibbleSyncResult> {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return { ok: false, isClockedIn: false, timeEntryId: null, error: "Not authenticated." };
    }

    const employeeId = await resolveJibbleEmployeeId(userId);
    if (!employeeId) {
      // No Jibble account linked — silently skip; don't treat as an error.
      return { ok: true, isClockedIn: false, timeEntryId: null, notLinked: true };
    }

    const accessToken = await getJibbleAccessToken();
    const { isClockedIn, timeEntryId } = await fetchActiveTimeEntry(employeeId, accessToken);

    return { ok: true, isClockedIn, timeEntryId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Jibble sync failed.";
    console.error("[syncUserJibbleStatus]", message);
    return { ok: false, isClockedIn: false, timeEntryId: null, error: message };
  }
}
