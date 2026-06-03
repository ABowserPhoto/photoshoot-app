"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

type ClockState = {
  isClockedIn: boolean;
  timeEntryId: string | null;
};

type ClockApiResponse = {
  ok?: boolean;
  timeEntryId?: string | number | null;
  error?: unknown;
};

const STORAGE_KEY = "jibble-clock-state-v1";

function readInitialClockState(): ClockState {
  if (typeof window === "undefined") {
    return { isClockedIn: false, timeEntryId: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { isClockedIn: false, timeEntryId: null };
    }
    const parsed = JSON.parse(raw) as Partial<ClockState>;
    return {
      isClockedIn: Boolean(parsed.isClockedIn),
      timeEntryId: typeof parsed.timeEntryId === "string" && parsed.timeEntryId.trim() ? parsed.timeEntryId : null,
    };
  } catch {
    return { isClockedIn: false, timeEntryId: null };
  }
}

function persistClockState(next: ClockState) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore localStorage write errors.
  }
}

function normalizeErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = [record.message, record.error, record.detail, record.title];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export default function JibbleClockToggle() {
  const [clockState, setClockState] = useState<ClockState>(() => readInitialClockState());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isClockedIn = clockState.isClockedIn;
  const buttonLabel = useMemo(() => {
    if (isLoading) {
      return isClockedIn ? "Clocking Out..." : "Clocking In...";
    }
    return isClockedIn ? "Clock Out" : "Clock In to Work";
  }, [isClockedIn, isLoading]);

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

      const timeEntryId =
        typeof json.timeEntryId === "string" || typeof json.timeEntryId === "number"
          ? String(json.timeEntryId)
          : null;
      const next = { isClockedIn: true, timeEntryId };
      setClockState(next);
      persistClockState(next);
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

      const next = { isClockedIn: false, timeEntryId: null };
      setClockState(next);
      persistClockState(next);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Clock out failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const buttonClassName = isClockedIn
    ? "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-500 bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
    : "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-500 bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void (isClockedIn ? handleClockOut() : handleClockIn())}
        disabled={isLoading}
        className={buttonClassName}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {buttonLabel}
      </button>
      {errorMessage ? <p className="max-w-xs text-right text-[11px] text-red-400">{errorMessage}</p> : null}
    </div>
  );
}
