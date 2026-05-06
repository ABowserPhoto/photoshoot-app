"use client";

import { useEffect, useState } from "react";
import type { BoardTask } from "./KanbanBoard";

export type MergePromptModalProps = {
  task: BoardTask | null;
  isOpen: boolean;
  onDismiss: () => void;
  onSkip: () => void | Promise<void>;
  onMerge: (bracketSize: 3 | 5) => void | Promise<void>;
  isProcessing?: boolean;
  errorMessage?: string | null;
};

export default function MergePromptModal({
  task,
  isOpen,
  onDismiss,
  onSkip,
  onMerge,
  isProcessing = false,
  errorMessage = null,
}: MergePromptModalProps) {
  const [bracketSize, setBracketSize] = useState<3 | 5>(3);

  useEffect(() => {
    if (task && isOpen) {
      setBracketSize(task.bracketSize === 5 ? 5 : 3);
    }
  }, [task, isOpen]);

  if (!isOpen || !task) {
    return null;
  }

  const headline =
    [task.photoshootType, task.companyName, task.shootLocation].filter(Boolean).join(" - ") || "This shoot";
  const subtitle = task.taskTitle?.trim() ? task.taskTitle.trim() : null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onClick={isProcessing ? undefined : onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-prompt-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 sm:p-8"
      >
        <h2 id="merge-prompt-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Selection available
        </h2>
        <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">{headline}</p>
        {subtitle ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        ) : null}

        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
          Do the photos for this shoot need to be merged?
        </p>

        <label className="mt-4 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Bracket size
          <select
            value={bracketSize}
            disabled={isProcessing}
            onChange={(event) =>
              setBracketSize(Number(event.target.value) === 5 ? 5 : 3)
            }
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value={3}>3 exposures</option>
            <option value={5}>5 exposures</option>
          </select>
        </label>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100"
          >
            <p className="font-semibold">Merge could not run</p>
            <p className="mt-1 whitespace-pre-wrap leading-snug">{errorMessage}</p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onDismiss}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => void onSkip()}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Skip &amp; Move
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => void onMerge(bracketSize)}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isProcessing ? "Working…" : "Merge Photos"}
          </button>
        </div>
      </div>
    </div>
  );
}
