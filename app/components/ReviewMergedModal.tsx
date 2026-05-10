"use client";

import { useCallback, useEffect, useState } from "react";
import type { BoardTask } from "./KanbanBoard";

type ReviewMergedModalProps = {
  task: BoardTask | null;
  isOpen: boolean;
  onClose: () => void;
};

type FileStatus = "idle" | "loading" | "ok" | "error";
type FileAction = "sky" | "remove";

type MergedItem = {
  name: string;
  storagePath: string;
  displayUrl: string;
  absoluteLocalPath: string;
};

function toErrorString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const maybe = (value as Record<string, unknown>).message;
    if (typeof maybe === "string" && maybe.trim()) return maybe;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function toSafeFilename(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const decodedPath = decodeURIComponent(url.pathname);
    const parts = decodedPath.split("/").filter(Boolean);
    return (parts.at(-1) ?? "").trim();
  } catch {
    const normalized = trimmed.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const last = parts.at(-1) ?? trimmed;
    const [withoutQuery] = last.split("?");
    const [withoutHash] = withoutQuery.split("#");
    return decodeURIComponent(withoutHash).trim();
  }
}

export default function ReviewMergedModal({ task, isOpen, onClose }: ReviewMergedModalProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [displayUrlByName, setDisplayUrlByName] = useState<Record<string, string>>({});
  const [absolutePathByName, setAbsolutePathByName] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [actionByFile, setActionByFile] = useState<Record<string, FileStatus>>({});
  const [activeActionByFile, setActiveActionByFile] = useState<Record<string, FileAction | null>>({});
  const [messageByFile, setMessageByFile] = useState<Record<string, string>>({});
  const [cacheBusterByFile, setCacheBusterByFile] = useState<Record<string, number>>({});
  const [removeDialogFile, setRemoveDialogFile] = useState<string | null>(null);
  const [removeDialogPrompt, setRemoveDialogPrompt] = useState("");

  const localFolderName = task?.localFolderName?.trim() ?? "";
  const taskId = task?.id?.trim() ?? "";

  const loadList = useCallback(async () => {
    if (!localFolderName && !taskId) {
      setFiles([]);
      return;
    }
    setIsLoadingList(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/list-merged?local_folder_name=${encodeURIComponent(localFolderName)}&task_id=${encodeURIComponent(taskId)}`,
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => null)) as
        | { files?: string[]; items?: MergedItem[]; error?: string }
        | null;
      if (!res.ok) {
        setLoadError(data?.error ?? `Failed to list files (${res.status})`);
        setFiles([]);
        return;
      }
      setFiles(data?.files ?? []);
      const items = (data?.items ?? []) || [];
      setDisplayUrlByName(
        Object.fromEntries(
          items.map((item) => [item.name, typeof item.displayUrl === "string" ? item.displayUrl : ""])
        )
      );
      setAbsolutePathByName(
        Object.fromEntries(
          items.map((item) => [item.name, typeof item.absoluteLocalPath === "string" ? item.absoluteLocalPath : ""])
        )
      );
      setActionByFile({});
      setActiveActionByFile({});
      setMessageByFile({});
      setCacheBusterByFile({});
      setRemoveDialogFile(null);
      setRemoveDialogPrompt("");
    } catch {
      setLoadError("Network error while loading merged files.");
      setFiles([]);
      setDisplayUrlByName({});
      setAbsolutePathByName({});
    } finally {
      setIsLoadingList(false);
    }
  }, [localFolderName, taskId]);

  useEffect(() => {
    if (isOpen && (localFolderName || taskId)) {
      void loadList();
    }
  }, [isOpen, localFolderName, taskId, loadList]);

  if (!isOpen || !task) {
    return null;
  }

  const headline =
    [task.photoshootType, task.companyName, task.shootLocation].filter(Boolean).join(" - ") || "Task";

  const handleReplaceSky = async (filename: string) => {
    const safeFilename = toSafeFilename(filename);
    if (!safeFilename) {
      setActionByFile((prev) => ({ ...prev, [filename]: "error" }));
      setMessageByFile((prev) => ({
        ...prev,
        [filename]: "Invalid filename.",
      }));
      return;
    }
    setActionByFile((prev) => ({ ...prev, [filename]: "loading" }));
    setActiveActionByFile((prev) => ({ ...prev, [filename]: "sky" }));
    setMessageByFile((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });
    try {
      const res = await fetch("/api/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          local_folder_name: localFolderName,
          task_id: taskId,
          filename: safeFilename,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: unknown;
        success?: boolean;
        promptId?: string;
      } | null;
      if (!res.ok) {
        setActionByFile((prev) => ({ ...prev, [filename]: "error" }));
        setMessageByFile((prev) => ({
          ...prev,
          [filename]: toErrorString(data?.error, `Request failed (${res.status})`),
        }));
        return;
      }
      setActionByFile((prev) => ({ ...prev, [filename]: "ok" }));
      setMessageByFile((prev) => ({
        ...prev,
        [filename]: data?.promptId ? `Queued (prompt ${data.promptId})` : "Queued for AI processing.",
      }));
      setCacheBusterByFile((prev) => ({ ...prev, [filename]: Date.now() }));
    } catch {
      setActionByFile((prev) => ({ ...prev, [filename]: "error" }));
      setMessageByFile((prev) => ({
        ...prev,
        [filename]: "Network error.",
      }));
    } finally {
      setActiveActionByFile((prev) => ({ ...prev, [filename]: null }));
    }
  };

  const submitRemoveObject = async (filename: string, absoluteLocalPath: string, removalTarget: string) => {
    const safeAbsolutePath = absoluteLocalPath.trim();
    if (!safeAbsolutePath) {
      setActionByFile((prev) => ({ ...prev, [filename]: "error" }));
      setMessageByFile((prev) => ({
        ...prev,
        [filename]: "Missing local file path.",
      }));
      return;
    }
    setActionByFile((prev) => ({ ...prev, [filename]: "loading" }));
    setActiveActionByFile((prev) => ({ ...prev, [filename]: "remove" }));
    setMessageByFile((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });

    try {
      const res = await fetch("/api/ai-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagePath: safeAbsolutePath,
          removalTarget,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: unknown;
        success?: boolean;
        promptId?: string;
      } | null;
      if (!res.ok) {
        setActionByFile((prev) => ({ ...prev, [filename]: "error" }));
        setMessageByFile((prev) => ({
          ...prev,
          [filename]: toErrorString(data?.error, `Request failed (${res.status})`),
        }));
        return;
      }
      setActionByFile((prev) => ({ ...prev, [filename]: "ok" }));
      setMessageByFile((prev) => ({
        ...prev,
        [filename]: data?.promptId
          ? `Object removal queued (prompt ${data.promptId}).`
          : "Object removal queued.",
      }));
      setCacheBusterByFile((prev) => ({ ...prev, [filename]: Date.now() }));
    } catch {
      setActionByFile((prev) => ({ ...prev, [filename]: "error" }));
      setMessageByFile((prev) => ({
        ...prev,
        [filename]: "Network error.",
      }));
    } finally {
      setActiveActionByFile((prev) => ({ ...prev, [filename]: null }));
    }
  };

  const handleOpenRemoveDialog = (filename: string) => {
    setRemoveDialogFile(filename);
    setRemoveDialogPrompt("");
  };

  const handleCloseRemoveDialog = () => {
    setRemoveDialogFile(null);
    setRemoveDialogPrompt("");
  };

  const handleConfirmRemoveDialog = async () => {
    if (!removeDialogFile) {
      return;
    }
    const promptText = removeDialogPrompt.trim();
    if (!promptText) {
      return;
    }
    const targetFile = removeDialogFile;
    const absoluteLocalPath = absolutePathByName[targetFile] ?? "";
    handleCloseRemoveDialog();
    await submitRemoveObject(targetFile, absoluteLocalPath, promptText);
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-merged-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 sm:p-8"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="review-merged-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Review merged photos
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{headline}</p>
            {localFolderName ? (
              <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">{localFolderName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!localFolderName ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            This task has no local folder name. Create folders from a booking first.
          </p>
        ) : isLoadingList ? (
          <p className="text-sm text-zinc-500">Loading merged images…</p>
        ) : loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-zinc-500">No images found in 3_Merged yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(files ?? []).map((filename) => {
              const cacheBuster = cacheBusterByFile[filename] ?? 0;
              const baseUrl = displayUrlByName[filename] ?? "";
              const src = baseUrl ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}v=${cacheBuster}` : "";
              const status = actionByFile[filename] ?? "idle";
              const activeAction = activeActionByFile[filename] ?? null;
              return (
                <div
                  key={filename}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/80"
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-zinc-200 dark:bg-zinc-950">
                    <button
                      type="button"
                      disabled={status === "loading"}
                      onClick={() => handleOpenRemoveDialog(filename)}
                      aria-label={`Remove object from ${filename}`}
                      className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300/90 bg-white/90 text-sm text-zinc-900 shadow-sm backdrop-blur hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600/90 dark:bg-zinc-900/90 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      title="Magic Wand"
                    >
                      {status === "loading" && activeAction === "remove" ? (
                        <span
                          className="inline-block size-3 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent dark:border-zinc-100 dark:border-t-transparent"
                          aria-hidden
                        />
                      ) : (
                        "🪄"
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={status === "loading"}
                      onClick={() => void handleReplaceSky(filename)}
                      aria-label={`Replace sky for ${filename}`}
                      className="absolute right-11 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300/90 bg-white/90 text-sm text-zinc-900 shadow-sm backdrop-blur hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600/90 dark:bg-zinc-900/90 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      title="Replace Sky"
                    >
                      {status === "loading" && activeAction === "sky" ? (
                        <span
                          className="inline-block size-3 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent dark:border-zinc-100 dark:border-t-transparent"
                          aria-hidden
                        />
                      ) : (
                        "☁️"
                      )}
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {src ? (
                      <img
                        src={src}
                        alt={filename}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                        Image URL unavailable
                      </div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-xs text-zinc-600 dark:text-zinc-400" title={filename}>
                    {filename}
                  </p>
                  {status === "ok" && messageByFile[filename] ? (
                    <p className="mt-1 text-xs text-green-700 dark:text-green-400">{messageByFile[filename]}</p>
                  ) : null}
                  {status === "error" && messageByFile[filename] ? (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{messageByFile[filename]}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {removeDialogFile ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-4" onClick={handleCloseRemoveDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-object-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900"
          >
            <h3 id="remove-object-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Remove Object
            </h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              What would you like to remove?
            </p>
            <input
              type="text"
              value={removeDialogPrompt}
              onChange={(event) => setRemoveDialogPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleConfirmRemoveDialog();
                }
              }}
              autoFocus
              placeholder="e.g. car, trash can, power line"
              className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCloseRemoveDialog}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRemoveDialog()}
                disabled={!removeDialogPrompt.trim()}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
