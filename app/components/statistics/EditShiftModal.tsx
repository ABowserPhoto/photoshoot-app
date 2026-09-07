"use client";

import { useEffect, useMemo, useState } from "react";

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function durationLabel(clockInLocal: string, clockOutLocal: string): string {
  const start = new Date(clockInLocal);
  const end = clockOutLocal ? new Date(clockOutLocal) : null;
  if (Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime()) || end <= start) {
    return "—";
  }
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) {
    return `${mins}m`;
  }
  return `${hours}h ${mins}m`;
}

export type EditShiftModalProps = {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  userName: string;
  date: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  isSaving?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (clockInAt: string, clockOutAt: string | null) => void;
};

export default function EditShiftModal({
  isOpen,
  title,
  subtitle,
  userName,
  date,
  clockInAt,
  clockOutAt,
  isSaving = false,
  error = null,
  onCancel,
  onSave,
}: EditShiftModalProps) {
  const [clockInLocal, setClockInLocal] = useState("");
  const [clockOutLocal, setClockOutLocal] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setClockInLocal(toDatetimeLocalValue(clockInAt));
    setClockOutLocal(toDatetimeLocalValue(clockOutAt));
  }, [clockInAt, clockOutAt, isOpen]);

  const previewDuration = useMemo(
    () => durationLabel(clockInLocal, clockOutLocal),
    [clockInLocal, clockOutLocal]
  );

  if (!isOpen) {
    return null;
  }

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
        aria-labelledby="edit-shift-title"
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="edit-shift-title" className="text-sm font-semibold text-zinc-100">
          {title}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          {userName} · {date}
          {subtitle ? ` · ${subtitle}` : ""}
        </p>

        <div className="mt-4 grid gap-3">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Clock in
            <input
              type="datetime-local"
              value={clockInLocal}
              onChange={(e) => setClockInLocal(e.target.value)}
              disabled={isSaving}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50 [color-scheme:dark]"
            />
          </label>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Clock out
            <input
              type="datetime-local"
              value={clockOutLocal}
              onChange={(e) => setClockOutLocal(e.target.value)}
              disabled={isSaving}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50 [color-scheme:dark]"
            />
          </label>
        </div>

        <p className="mt-2 text-xs text-zinc-400">
          Duration: <span className="font-mono font-semibold text-zinc-200">{previewDuration}</span>
          {!clockOutLocal ? " (open shift)" : ""}
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
            onClick={() => {
              const clockInIso = fromDatetimeLocalValue(clockInLocal);
              if (!clockInIso) {
                return;
              }
              onSave(clockInIso, fromDatetimeLocalValue(clockOutLocal));
            }}
            disabled={isSaving || !clockInLocal}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save shift"}
          </button>
        </div>
      </div>
    </div>
  );
}
