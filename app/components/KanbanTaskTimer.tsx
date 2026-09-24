"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { adjustTaskEditingDuration } from "@/app/actions/tasks";
import { formatDurationHms, parseHumanDurationToSeconds } from "@/lib/parseDuration";

export type KanbanTaskTimerUpdate = {
  taskId: string;
  totalEditingSeconds: number;
  editingStartedAt: string | null;
};

type KanbanTaskTimerProps = {
  taskId: string;
  liveSeconds: number;
  isRunning: boolean;
  isAdmin: boolean;
  onUpdated: (update: KanbanTaskTimerUpdate) => void;
};

function stopCardInteraction(event: SyntheticEvent) {
  event.stopPropagation();
}

export default function KanbanTaskTimer({
  taskId,
  liveSeconds,
  isRunning,
  isAdmin,
  onUpdated,
}: KanbanTaskTimerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commitLockRef = useRef(false);

  const display = formatDurationHms(liveSeconds);
  const label = isRunning ? "Editing: " : "Total Edit Time: ";

  useEffect(() => {
    if (!editing) return;
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, [editing]);

  const closeEditor = () => {
    setEditing(false);
    setDraft("");
    setError(null);
    setSaving(false);
  };

  const commit = async () => {
    if (commitLockRef.current || saving) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      commitLockRef.current = true;
      closeEditor();
      return;
    }
    const parsed = parseHumanDurationToSeconds(trimmed);
    if (parsed === null) {
      setError("Use HH:MM:SS or 12m 30s.");
      inputRef.current?.focus();
      return;
    }
    if (parsed === Math.max(0, Math.floor(liveSeconds))) {
      commitLockRef.current = true;
      closeEditor();
      return;
    }

    commitLockRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await adjustTaskEditingDuration(taskId, parsed);
      if (!res.ok) {
        throw new Error(res.error);
      }
      onUpdated({
        taskId,
        totalEditingSeconds: res.totalEditingSeconds,
        editingStartedAt: res.editingStartedAt,
      });
      closeEditor();
    } catch (err) {
      commitLockRef.current = false;
      setSaving(false);
      setError(err instanceof Error ? err.message : "Could not save duration.");
      inputRef.current?.focus();
    }
  };

  const beginEdit = () => {
    if (!isAdmin || saving) return;
    commitLockRef.current = false;
    setError(null);
    setDraft(display);
    setEditing(true);
  };

  if (!isAdmin) {
    return (
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
        {label}
        <span className="font-mono">{display}</span>
      </p>
    );
  }

  if (editing) {
    return (
      <div
        className="relative z-[1] mt-1 pointer-events-auto"
        onClick={stopCardInteraction}
        onMouseDown={stopCardInteraction}
        onPointerDown={stopCardInteraction}
        onDragStart={(event) => {
          event.preventDefault();
          stopCardInteraction(event);
        }}
      >
        <label className="sr-only" htmlFor={`task-timer-${taskId}`}>
          Edit task duration
        </label>
        <input
          ref={inputRef}
          id={`task-timer-${taskId}`}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          disabled={saving}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `task-timer-error-${taskId}` : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onBlur={() => {
            void commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              commitLockRef.current = true;
              closeEditor();
            }
          }}
          className="w-[7.5rem] rounded border border-violet-400 bg-white px-1.5 py-0.5 font-mono text-xs text-zinc-900 outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-60 dark:border-violet-500 dark:bg-zinc-950 dark:text-zinc-100"
        />
        {saving ? <span className="ml-1 text-[11px] text-zinc-500">Saving…</span> : null}
        {error ? (
          <p id={`task-timer-error-${taskId}`} className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : (
          <p className="mt-0.5 text-[11px] text-zinc-400">Enter or click away to save. Esc cancels.</p>
        )}
      </div>
    );
  }

  return (
    <p className="relative z-[1] mt-1 text-xs text-zinc-500 pointer-events-auto dark:text-zinc-500">
      {label}
      <button
        type="button"
        title="Click to edit duration"
        aria-label={`Edit duration ${display}`}
        onClick={(event) => {
          stopCardInteraction(event);
          beginEdit();
        }}
        onMouseDown={stopCardInteraction}
        onPointerDown={stopCardInteraction}
        onDragStart={(event) => {
          event.preventDefault();
          stopCardInteraction(event);
        }}
        className="cursor-text rounded px-0.5 font-mono text-zinc-600 underline-offset-2 hover:bg-zinc-100 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        {display}
      </button>
    </p>
  );
}
