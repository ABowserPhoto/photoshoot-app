"use client";

import { useEffect, useState, type DragEvent } from "react";

import { getElectronFilePath } from "@/lib/plannerFilePath";

type PlannerPauseTaskModalProps = {
  isOpen: boolean;
  pauseNotes: string;
  pauseFilePath: string;
  isSaving?: boolean;
  onPauseNotesChange: (value: string) => void;
  onPauseFilePathChange: (value: string) => void;
  onConfirmPause: () => void;
  onCancel: () => void;
};

export default function PlannerPauseTaskModal({
  isOpen,
  pauseNotes,
  pauseFilePath,
  isSaving = false,
  onPauseNotesChange,
  onPauseFilePathChange,
  onConfirmPause,
  onCancel,
}: PlannerPauseTaskModalProps) {
  const [isDropzoneActive, setIsDropzoneActive] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsDropzoneActive(false);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropzoneActive(true);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropzoneActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropzoneActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropzoneActive(false);

    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }

    const absolutePath = getElectronFilePath(file);
    if (absolutePath) {
      onPauseFilePathChange(absolutePath);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4"
      onClick={() => {
        if (!isSaving) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="planner-pause-task-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
      >
        <h2 id="planner-pause-task-title" className="text-lg font-semibold text-zinc-100">
          Pause Task
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Include any important details necessary to the status of this task.
        </p>

        <textarea
          value={pauseNotes}
          onChange={(event) => onPauseNotesChange(event.target.value)}
          placeholder="e.g. Waiting on client feedback, mid-export, blocked on assets…"
          disabled={isSaving}
          className="mb-4 mt-4 min-h-[100px] w-full rounded-md border border-zinc-600 bg-zinc-800 p-3 text-sm text-white outline-none ring-blue-500 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
        />

        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
            isDropzoneActive
              ? "border-blue-500 bg-blue-950/20"
              : "border-zinc-600 hover:bg-zinc-800/50"
          }`}
        >
          <p className="mb-4 text-center text-sm text-zinc-400">
            Drag and drop files/folders here (desktop app), or paste a web link.
          </p>
          <input
            value={pauseFilePath}
            onChange={(event) => onPauseFilePathChange(event.target.value)}
            placeholder="https://… or C:\Projects\WorkingFiles"
            disabled={isSaving}
            className="w-full rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-600 px-4 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirmPause}
            disabled={isSaving}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Pausing…" : "Confirm Pause"}
          </button>
        </div>
      </div>
    </div>
  );
}
