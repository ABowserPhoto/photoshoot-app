"use client";

import { Coffee, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

import { syncUserJibbleStatus } from "@/app/actions/jibble-sync";
import { usePlannerGlobalSafe } from "@/app/contexts/PlannerGlobalContext";

type ClockMode = "out" | "working" | "break";

type ClockState = {
  mode: ClockMode;
  timeEntryId: string | null;
};

type ClockApiResponse = {
  ok?: boolean;
  mode?: ClockMode;
  timeEntryId?: string | number | null;
  error?: unknown;
  pausedTasks?: Array<{ id?: string; elapsed_seconds?: number }>;
};

const STORAGE_KEY = "jibble-clock-state-v2";
export const JIBBLE_BREAK_PAUSED_EVENT = "jibble:break-paused-studio-tasks";

function readInitialClockState(): ClockState {
  if (typeof window === "undefined") {
    return { mode: "out", timeEntryId: null };
  }
  try {
    const rawV2 = window.localStorage.getItem(STORAGE_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Partial<ClockState>;
      const mode =
        parsed.mode === "working" || parsed.mode === "break" || parsed.mode === "out"
          ? parsed.mode
          : "out";
      return {
        mode,
        timeEntryId:
          typeof parsed.timeEntryId === "string" && parsed.timeEntryId.trim()
            ? parsed.timeEntryId
            : null,
      };
    }

    // Migrate legacy v1 cache ({ isClockedIn }) if present.
    const rawV1 = window.localStorage.getItem("jibble-clock-state-v1");
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as { isClockedIn?: boolean; timeEntryId?: string | null };
      return {
        mode: parsed.isClockedIn ? "working" : "out",
        timeEntryId:
          typeof parsed.timeEntryId === "string" && parsed.timeEntryId.trim()
            ? parsed.timeEntryId
            : null,
      };
    }

    return { mode: "out", timeEntryId: null };
  } catch {
    return { mode: "out", timeEntryId: null };
  }
}

function persistClockState(next: ClockState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore localStorage write errors.
  }
}

function normalizeErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = [record.message, record.error, record.detail, record.title];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function timeEntryIdFromResponse(json: ClockApiResponse | null): string | null {
  return typeof json?.timeEntryId === "string" || typeof json?.timeEntryId === "number"
    ? String(json.timeEntryId)
    : null;
}

function notifyStudioTasksPausedFromJibbleBreak(
  pausedTasks: Array<{ id?: string; elapsed_seconds?: number }> | undefined
) {
  if (typeof window === "undefined") return;
  const ids = (pausedTasks ?? [])
    .map((t) => (typeof t.id === "string" ? t.id.trim() : ""))
    .filter(Boolean);
  const elapsedById: Record<string, number> = {};
  for (const t of pausedTasks ?? []) {
    if (typeof t.id === "string" && t.id.trim() && typeof t.elapsed_seconds === "number") {
      elapsedById[t.id.trim()] = Math.max(0, t.elapsed_seconds);
    }
  }
  window.dispatchEvent(
    new CustomEvent(JIBBLE_BREAK_PAUSED_EVENT, {
      detail: { taskIds: ids, elapsedById },
    })
  );
  window.dispatchEvent(new Event("desktop-widget:refresh"));
}

export default function JibbleClockToggle() {
  const plannerGlobal = usePlannerGlobalSafe();
  const [clockState, setClockState] = useState<ClockState>(() => readInitialClockState());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncing, startSyncTransition] = useTransition();

  const mode = clockState.mode;

  useEffect(() => {
    startSyncTransition(async () => {
      const result = await syncUserJibbleStatus();
      if (!result.ok || result.notLinked) return;

      setClockState((prev) => {
        const nextMode = result.mode ?? (result.isClockedIn ? "working" : "out");
        if (prev.mode === nextMode && prev.timeEntryId === result.timeEntryId) {
          return prev;
        }
        const next: ClockState = {
          mode: nextMode,
          timeEntryId: result.timeEntryId,
        };
        persistClockState(next);
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const primaryLabel = useMemo(() => {
    if (isLoading) {
      if (mode === "out") return "Clocking In...";
      return "Clocking Out...";
    }
    if (mode === "out") return "Clock In to Work";
    return "Clock Out";
  }, [isLoading, mode]);

  const breakLabel = useMemo(() => {
    if (isLoading) {
      return mode === "break" ? "Resuming..." : "Starting Break...";
    }
    return mode === "break" ? "Resume Work" : "Pause";
  }, [isLoading, mode]);

  const applyMode = (nextMode: ClockMode, timeEntryId: string | null) => {
    const next = { mode: nextMode, timeEntryId };
    setClockState(next);
    persistClockState(next);
  };

  const handleClockIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/jibble/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await response.json().catch(() => null)) as ClockApiResponse | null;
      if (!response.ok || !json?.ok) {
        throw new Error(
          normalizeErrorMessage(json?.error, `Clock in failed (HTTP ${response.status}).`)
        );
      }
      applyMode("working", timeEntryIdFromResponse(json));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Clock in failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockOut = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/jibble/clock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeEntryId: clockState.timeEntryId }),
      });
      const json = (await response.json().catch(() => null)) as ClockApiResponse | null;
      if (!response.ok || !json?.ok) {
        throw new Error(
          normalizeErrorMessage(json?.error, `Clock out failed (HTTP ${response.status}).`)
        );
      }
      applyMode("out", null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Clock out failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBreak = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/jibble/break", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await response.json().catch(() => null)) as ClockApiResponse | null;
      if (!response.ok || !json?.ok) {
        throw new Error(
          normalizeErrorMessage(json?.error, `Break failed (HTTP ${response.status}).`)
        );
      }
      applyMode("break", timeEntryIdFromResponse(json));

      // Clear floating widget immediately; planner board refreshes via event.
      plannerGlobal?.setActiveTimerSession(null);
      notifyStudioTasksPausedFromJibbleBreak(json.pausedTasks);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Break failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResume = async () => {
    // Jibble ends a break by posting another "In" time entry.
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/jibble/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await response.json().catch(() => null)) as ClockApiResponse | null;
      if (!response.ok || !json?.ok) {
        throw new Error(
          normalizeErrorMessage(json?.error, `Resume failed (HTTP ${response.status}).`)
        );
      }
      applyMode("working", timeEntryIdFromResponse(json));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Resume failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const primaryButtonClass =
    mode === "out"
      ? "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-500 bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      : "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-500 bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60";

  const breakButtonClass =
    mode === "break"
      ? "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-500 bg-amber-500 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
      : "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-600/80 bg-amber-600/20 px-4 text-sm font-semibold text-amber-200 transition hover:bg-amber-600/35 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {isSyncing ? (
          <RefreshCw
            className="h-3.5 w-3.5 animate-spin text-zinc-400"
            aria-label="Syncing Jibble status…"
          />
        ) : null}

        {mode === "working" || mode === "break" ? (
          <button
            type="button"
            onClick={() => void (mode === "break" ? handleResume() : handleBreak())}
            disabled={isLoading || isSyncing}
            className={breakButtonClass}
            title={mode === "break" ? "End break and resume work" : "Start a break"}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Coffee className="h-4 w-4" aria-hidden />
            )}
            {breakLabel}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => void (mode === "out" ? handleClockIn() : handleClockOut())}
          disabled={isLoading || isSyncing}
          className={primaryButtonClass}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {primaryLabel}
        </button>
      </div>
      {mode === "break" ? (
        <p className="text-right text-[11px] font-medium text-amber-300/90">On break</p>
      ) : null}
      {errorMessage ? <p className="max-w-xs text-right text-[11px] text-red-400">{errorMessage}</p> : null}
    </div>
  );
}
