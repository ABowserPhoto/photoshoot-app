import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const JIBBLE_TOKEN_URL = "https://identity.prod.jibble.io/connect/token";
export const JIBBLE_TIME_ENTRIES_URL = "https://time-tracking.prod.jibble.io/v1/TimeEntries";
export const JIBBLE_GET_BREAKS_URL = "https://time-tracking.prod.jibble.io/v1/GetBreaks";

/**
 * Discrete TimeEntries types accepted by Jibble's v1 API enum `TimeEntryType`.
 * Note: the UI label "Break" maps to API value `StartBreak` — not `Break`.
 */
export type JibbleTimeEntryType = "In" | "Out" | "StartBreak";

export type JibbleClockMode = "out" | "working" | "break";

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

export async function getSessionUserId(): Promise<string | null> {
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
      setAll() {
        // No-op for route/action reads.
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function gatekeeperFallbackEmployeeId(role: "admin" | "editor"): string | null {
  const roleKey = role === "admin" ? "JIBBLE_ADMIN_EMPLOYEE_ID" : "JIBBLE_EDITOR_EMPLOYEE_ID";
  const roleValue = process.env[roleKey]?.trim();
  if (roleValue) {
    return roleValue;
  }
  return process.env.JIBBLE_GATEKEEPER_EMPLOYEE_ID?.trim() || null;
}

export async function resolveJibbleEmployeeId(params: {
  userId: string | null;
  role?: "admin" | "editor";
}): Promise<{ id: string | null; notLinked: boolean }> {
  const { userId, role } = params;
  if (userId) {
    const sb = serviceSupabase();
    if (sb) {
      const { data, error } = await sb
        .from("profiles")
        .select("jibble_employee_id")
        .eq("id", userId)
        .maybeSingle();
      if (!error) {
        const value = (data as { jibble_employee_id?: unknown } | null)?.jibble_employee_id;
        if (typeof value === "string" && value.trim()) {
          return { id: value.trim(), notLinked: false };
        }
      }
    }
    return { id: null, notLinked: true };
  }

  if (role) {
    return { id: gatekeeperFallbackEmployeeId(role), notLinked: false };
  }
  return { id: null, notLinked: true };
}

export async function getJibbleAccessToken(): Promise<string> {
  const clientId = process.env.JIBBLE_CLIENT_ID?.trim();
  const clientSecret = process.env.JIBBLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing JIBBLE_CLIENT_ID or JIBBLE_CLIENT_SECRET in environment.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const response = await fetch(JIBBLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  const json = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        error_description?: string;
        error?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      json?.error_description ||
        json?.error ||
        `Jibble token handshake failed (HTTP ${response.status}).`
    );
  }

  const token = json?.access_token?.trim();
  if (!token) {
    throw new Error("Jibble token handshake succeeded but access_token was missing.");
  }
  return token;
}

export function formatJibbleError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const directMessageCandidates = [
    record.message,
    record.error_description,
    record.error,
    record.title,
    record.detail,
  ];
  for (const candidate of directMessageCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  const nested = record.error;
  if (nested && typeof nested === "object") {
    const nestedMessage = (nested as Record<string, unknown>).message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return nestedMessage;
    }
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return fallback;
  }
}

function buildPlatform() {
  return {
    clientVersion: "web 3.0",
    os: "Windows 11",
    deviceModel: "Studio App Custom Widget",
    deviceName: "Studio Desktop App",
  };
}

function buildTimeEntryPayload(
  employeeId: string,
  type: JibbleTimeEntryType,
  options?: { breakId?: string | null }
) {
  const payload: Record<string, unknown> = {
    personId: employeeId,
    type,
    clientType: "Web",
    platform: buildPlatform(),
  };

  const breakId = options?.breakId?.trim();
  if (breakId) {
    payload.breakId = breakId;
  }

  return payload;
}

type PostTimeEntryResult =
  | { ok: true; employeeId: string; type: JibbleTimeEntryType; breakId: string | null; raw: unknown }
  | { ok: false; status: number; error: string; raw: unknown };

export async function postJibbleTimeEntry(params: {
  employeeId: string;
  type: JibbleTimeEntryType;
  breakId?: string | null;
  accessToken?: string;
}): Promise<PostTimeEntryResult> {
  const accessToken = params.accessToken ?? (await getJibbleAccessToken());
  const breakId = params.breakId?.trim() || null;
  const payload = buildTimeEntryPayload(params.employeeId, params.type, { breakId });

  const response = await fetch(JIBBLE_TIME_ENTRIES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const json = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: formatJibbleError(json, `Jibble ${params.type} failed (HTTP ${response.status}).`),
      raw: json,
    };
  }

  return {
    ok: true,
    employeeId: params.employeeId,
    type: params.type,
    breakId,
    raw: json,
  };
}

/**
 * Resolves an optional custom break policy id.
 * Free-form org breaks (empty schedule `breaks`) do not require one —
 * `StartBreak` alone is enough. For custom breaks, pass `breakId`, set
 * `JIBBLE_BREAK_ID`, or let this pick the first available from GetBreaks.
 */
export async function resolveJibbleBreakId(params: {
  employeeId: string;
  breakId?: string | null;
  accessToken?: string;
}): Promise<string | null> {
  const explicit = params.breakId?.trim();
  if (explicit) {
    return explicit;
  }

  const fromEnv = process.env.JIBBLE_BREAK_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const accessToken = params.accessToken ?? (await getJibbleAccessToken());
  const time = new Date().toISOString();
  const url = `${JIBBLE_GET_BREAKS_URL}(personId=${params.employeeId},time=${time})`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const raw = (await response.json().catch(() => null)) as unknown;
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.value)
      ? ((raw as Record<string, unknown>).value as unknown[])
      : [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.isAvailable === false) continue;
    if (typeof record.id === "string" && record.id.trim()) {
      return record.id.trim();
    }
  }

  return null;
}

/** Starts a break via `type: "StartBreak"` (+ optional `breakId` for custom policies). */
export async function postJibbleBreakEntry(params: {
  employeeId: string;
  breakId?: string | null;
  accessToken?: string;
}): Promise<PostTimeEntryResult> {
  const accessToken = params.accessToken ?? (await getJibbleAccessToken());
  const breakId = await resolveJibbleBreakId({
    employeeId: params.employeeId,
    breakId: params.breakId,
    accessToken,
  });

  return postJibbleTimeEntry({
    employeeId: params.employeeId,
    type: "StartBreak",
    breakId,
    accessToken,
  });
}

/** Resume from break — same as clock-in (`type: "In"`). */
export async function postJibbleResumeEntry(params: {
  employeeId: string;
  accessToken?: string;
}): Promise<PostTimeEntryResult> {
  return postJibbleTimeEntry({
    employeeId: params.employeeId,
    type: "In",
    accessToken: params.accessToken,
  });
}

function normalizeEntryType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function extractBreakId(entry: Record<string, unknown>): string | null {
  if (typeof entry.breakId === "string" && entry.breakId.trim()) {
    return entry.breakId.trim();
  }
  const nested = entry.break;
  if (nested && typeof nested === "object") {
    const id = (nested as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }
  }
  return null;
}

export function modeFromLatestEntry(entry: {
  type?: unknown;
  breakId?: unknown;
  break?: unknown;
}): JibbleClockMode {
  const entryType = normalizeEntryType(entry.type);
  const breakId = extractBreakId(entry as Record<string, unknown>);

  if (
    entryType === "startbreak" ||
    entryType === "start_break" ||
    // Defensive: some clients historically posted Out + breakId for breaks.
    (entryType === "out" && Boolean(breakId))
  ) {
    return "break";
  }
  if (entryType === "in") {
    return "working";
  }
  return "out";
}

/** @deprecated Prefer `modeFromLatestEntry` — kept for call sites that only have a type string. */
export function modeFromLatestEntryType(entryType: string): JibbleClockMode {
  return modeFromLatestEntry({ type: entryType });
}

/**
 * Fetches recent TimeEntries and maps the newest entry to LoggedOut / Working / OnBreak.
 * On break = latest type is `StartBreak` (or Out with a breakId).
 * Resume-from-break is modeled as a fresh `In` entry.
 */
export async function fetchLatestJibbleClockMode(
  employeeId: string,
  accessToken: string
): Promise<{ mode: JibbleClockMode; timeEntryId: string | null; entryType: string | null }> {
  const url = new URL(JIBBLE_TIME_ENTRIES_URL);
  // personId is Edm.Guid — do not quote the UUID in the OData filter.
  url.searchParams.set("$filter", `personId eq ${employeeId}`);
  url.searchParams.set("$orderby", "time desc");
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
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.value)
      ? ((raw as Record<string, unknown>).value as unknown[])
      : [];

  if (items.length === 0) {
    return { mode: "out", timeEntryId: null, entryType: null };
  }

  const latest = items[0] as Record<string, unknown>;
  const entryType = normalizeEntryType(latest.type);
  const timeEntryId = typeof latest.id === "string" ? latest.id : null;
  return {
    mode: modeFromLatestEntry(latest),
    timeEntryId,
    entryType: entryType || null,
  };
}
