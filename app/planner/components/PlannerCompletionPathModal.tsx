"use client";

import { useState, type DragEvent } from "react";

import { getDirectoryFromFilePath, getElectronFilePath } from "@/lib/plannerFilePath";

type PlannerCompletionPathModalProps = {
  isOpen: boolean;
  fileLocations: string[];
  isSaving?: boolean;
  onFileLocationsChange: (values: string[]) => void;
  onSavePath: () => void;
  onCancel: () => void;
};

export default function PlannerCompletionPathModal({
  isOpen,
  fileLocations,
  isSaving = false,
  onFileLocationsChange,
  onSavePath,
  onCancel,
}: PlannerCompletionPathModalProps) {
  const [isDropzoneActive, setIsDropzoneActive] = useState(false);

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
      const nextPath = getDirectoryFromFilePath(absolutePath).trim();
      if (!nextPath) {
        return;
      }
      const cleaned = fileLocations.map((value) => value.trim()).filter(Boolean);
      onFileLocationsChange(cleaned.includes(nextPath) ? cleaned : [...cleaned, nextPath]);
    }
  };

  const effectiveLocations = fileLocations.length > 0 ? fileLocations : [""];

  const handleUpdateLocation = (index: number, value: string) => {
    const next = [...effectiveLocations];
    next[index] = value;
    onFileLocationsChange(next);
  };

  const handleRemoveLocation = (index: number) => {
    onFileLocationsChange(effectiveLocations.filter((_, i) => i !== index));
  };

  const handleAddLocation = () => {
    onFileLocationsChange([...effectiveLocations, ""]);
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
        aria-labelledby="planner-completion-path-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
      >
        <h2 id="planner-completion-path-title" className="text-lg font-semibold text-zinc-100">
          Task Completed! Link Finished Files
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Add one or more local paths/links for finished deliverables before finalizing completion.
        </p>

        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mt-5 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            isDropzoneActive
              ? "border-blue-500 bg-blue-950/20"
              : "border-zinc-600 hover:bg-zinc-800/50"
          }`}
        >
          <p className="mb-4 text-center text-sm text-zinc-400">
            Drag and drop a finished folder here, or paste paths/links manually.
          </p>
          <div className="w-full space-y-2">
            {effectiveLocations.map((location, index) => (
              <div key={`completion-location-${index}`} className="flex items-center gap-2">
                <input
                  value={location}
                  onChange={(event) => handleUpdateLocation(index, event.target.value)}
                  placeholder="C:\\Projects\\Deliverables\\Shoot-001 or https://link"
                  className="w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-zinc-500 focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveLocation(index)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-600 text-sm font-bold text-zinc-200 transition hover:bg-zinc-800"
                  aria-label="Remove location"
                  title="Remove location"
                >
                  x
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleAddLocation}
            className="mt-3 inline-flex h-8 items-center justify-center rounded-md border border-zinc-600 px-3 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
          >
            + Add Location
          </button>
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
            onClick={onSavePath}
            disabled={isSaving}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save Path"}
          </button>
        </div>
      </div>
    </div>
  );
}
