"use server";

import {
  fetchLatestJibbleClockMode,
  getJibbleAccessToken,
  getSessionUserId,
  resolveJibbleEmployeeId,
  type JibbleClockMode,
} from "@/lib/server/jibbleTimeEntries";

export type JibbleSyncResult = {
  ok: boolean;
  /** @deprecated Prefer `mode` — kept for older clients. */
  isClockedIn: boolean;
  mode: JibbleClockMode;
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
 * by the user clocking in/out/break via the Jibble mobile app.
 */
export async function syncUserJibbleStatus(): Promise<JibbleSyncResult> {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return {
        ok: false,
        isClockedIn: false,
        mode: "out",
        timeEntryId: null,
        error: "Not authenticated.",
      };
    }

    const { id: employeeId } = await resolveJibbleEmployeeId({ userId });
    if (!employeeId) {
      return {
        ok: true,
        isClockedIn: false,
        mode: "out",
        timeEntryId: null,
        notLinked: true,
      };
    }

    const accessToken = await getJibbleAccessToken();
    const { mode, timeEntryId } = await fetchLatestJibbleClockMode(employeeId, accessToken);

    return {
      ok: true,
      isClockedIn: mode === "working" || mode === "break",
      mode,
      timeEntryId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Jibble sync failed.";
    console.error("[syncUserJibbleStatus]", message);
    return {
      ok: false,
      isClockedIn: false,
      mode: "out",
      timeEntryId: null,
      error: message,
    };
  }
}
