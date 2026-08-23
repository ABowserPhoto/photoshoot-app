import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicEnv } from "@/lib/supabaseEnv";

const { url: supabaseUrl, anonKey: supabaseAnonKey } = getSupabasePublicEnv();

/** localStorage key for client-side inactivity tracking (AutoLogout). */
export const LAST_ACTIVE_STORAGE_KEY = "workflow_last_active_time";

/** 30 minutes — employees must re-authenticate after this idle period. */
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export function readLastActiveTime(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLastActiveTime(timestamp = Date.now()): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LAST_ACTIVE_STORAGE_KEY, String(timestamp));
  } catch {
    // Ignore quota / private-mode errors.
  }
}

export function clearLastActiveTime(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(LAST_ACTIVE_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

if (typeof window !== "undefined" && (!supabaseUrl || !supabaseAnonKey)) {
  console.error(
    "[supabaseClient] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "These must be set in the Vercel project Environment Variables for Production " +
      "(and available at build time for client bundles). Auth, realtime, and module nav will fail."
  );
}

/**
 * Cookie-backed browser client so Supabase sessions are visible to middleware
 * and server actions (getAuthRole, handleClockIn, etc.).
 */
export const supabase =
  supabaseUrl && supabaseAnonKey ? createBrowserClient(supabaseUrl, supabaseAnonKey) : null;
