"use client";

import { useEffect, useState } from "react";

export type EditDurationModalProps = {
  isOpen: boolean;
  title?: string;
  /** Current displayed duration in whole seconds (live elapsed if running). */
  initialSeconds: number;
  isSaving?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (totalSeconds: number) => void;
};

function clampNonNegInt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 99999);
}

function splitSeconds(totalSeconds: number): { hours: number; minutes: number; seconds: number } {
  const s = Math.max(0, Math.floor(totalSeconds));
  return {
    hours: Math.floor(s / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

export function combineDurationParts(hours: number, minutes: number, seconds: number): number {
  return Math.max(0, hours) * 3600 + Math.max(0, minutes) * 60 + Math.max(0, seconds);
}

/**
 * Admin-only modal to adjust a logged timer duration (H / M / S).
 */
export default function EditDurationModal({
  isOpen,
  title = "Edit Duration",
  initialSeconds,
  isSaving = false,
  error = null,
  onCancel,
  onSave,
}: EditDurationModalProps) {
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("0");
  const [seconds, setSeconds] = useState("0");

  useEffect(() => {
    if (!isOpen) return;
    const parts = splitSeconds(initialSeconds);
    setHours(String(parts.hours));
    setMinutes(String(parts.minutes));
    setSeconds(String(parts.seconds));
  }, [isOpen, initialSeconds]);

  if (!isOpen) return null;

  const total = combineDurationParts(
    clampNonNegInt(hours),
    clampNonNegInt(minutes),
    clampNonNegInt(seconds)
  );

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4"
      onClick={() => {
        if (!isSaving) onCancel();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-duration-title"
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="edit-duration-title" className="text-sm font-semibold text-zinc-100">
          {title}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Adjust the logged timer. If the timer is running, it will continue from this new value.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Hours
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              disabled={isSaving}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-center text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-50"
            />
          </label>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Minutes
            <input
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              disabled={isSaving}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-center text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-50"
            />
          </label>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Seconds
            <input
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              disabled={isSaving}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-center text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-50"
            />
          </label>
        </div>

        <p className="mt-2 text-center text-xs text-zinc-400">
          Total:{" "}
          <span className="font-mono font-semibold text-zinc-200">
            {Math.floor(total / 3600)}h {Math.floor((total % 3600) / 60)}m {total % 60}s
          </span>
        </p>

        {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(total)}
            disabled={isSaving}
            className="rounded-lg border border-amber-600/50 bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save Timer Adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}
