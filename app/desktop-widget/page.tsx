"use client";

import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Pause,
  Play,
  Plus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { formatPlannerDuration, getPlannerElapsedSeconds } from "@/lib/plannerTimerUtils";
import { supabase } from "@/lib/supabaseClient";

/** Electron-specific CSS property — not in the standard React types. */
type ElectronCSS = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };

const dragStyle: ElectronCSS = { WebkitAppRegion: "drag" };
const noDragStyle: ElectronCSS = { WebkitAppRegion: "no-drag" };

type ViewMode = "studio" | "workflow";
type StudioTaskStatus = "master" | "planning" | "processing" | "completed";

type WidgetTask = {
  id: string;
  title: string;
  status: string;
  startedAtSec: number | null;
  elapsedSeconds: number;
  isPaused: boolean;
};

type ApiTaskRow = {
  id: string;
  title: string | null;
  status: string | null;
  started_at: string | null;
  elapsed_seconds: number | null;
  assigned_to?: string | null;
};

const IPC_CHANNELS = {
  REFRESH_MAIN: "desktop-widget:refresh-main",
  REFRESH_EVENT: "desktop-widget:refresh",
  HIDE_WIDGET: "desktop-widget:hide",
  FOCUS_MAIN: "desktop-widget:focus-main",
  RESIZE_WIDGET: "desktop-widget:resize",
} as const;

const WIDGET_PAD_PX = 16;
const WIDGET_COLLAPSED_HEIGHT = 260;
const WIDGET_EXPANDED_HEIGHT = 450;

function getIpcRenderer():
  | {
      on: (channel: string, listener: (...args: unknown[]) => void) => void;
      removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
      send: (channel: string, payload?: unknown) => void;
    }
  | null {
  if (typeof window === "undefined") {
    return null;
  }
  const electron = (window as typeof window & { require?: (name: string) => unknown }).require?.(
    "electron"
  ) as { ipcRenderer?: ReturnType<typeof getIpcRenderer> } | undefined;
  return electron?.ipcRenderer ?? null;
}

function normalizeStudioStatus(value: string | null | undefined): StudioTaskStatus {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "planning" || normalized === "processing" || normalized === "completed") {
    return normalized;
  }
  return "master";
}

function mapRowToTask(row: ApiTaskRow, view: ViewMode): WidgetTask {
  const startedAtMs = row.started_at ? new Date(row.started_at).getTime() : Number.NaN;
  const startedAtSec = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
  const elapsedSeconds = Math.max(0, row.elapsed_seconds ?? 0);
  const status = row.status?.trim() || (view === "studio" ? "master" : "Ready for Review");

  if (view === "workflow") {
    const isEditing = status.toLowerCase() === "editing";
    return {
      id: String(row.id),
      title: row.title?.trim() || "Untitled Task",
      status,
      startedAtSec,
      elapsedSeconds,
      isPaused: isEditing && startedAtSec === null,
    };
  }

  const studioStatus = normalizeStudioStatus(status);
  return {
    id: String(row.id),
    title: row.title?.trim() || "Untitled Task",
    status: studioStatus,
    startedAtSec,
    elapsedSeconds,
    isPaused:
      startedAtSec === null &&
      elapsedSeconds > 0 &&
      (studioStatus === "planning" || studioStatus === "processing"),
  };
}

function isTaskActivelyRunning(task: WidgetTask, view: ViewMode): boolean {
  if (view === "workflow") {
    return task.status.toLowerCase() === "editing" && task.startedAtSec !== null && !task.isPaused;
  }
  return task.status === "processing" && task.startedAtSec !== null && !task.isPaused;
}

export default function DesktopWidgetPage() {
  const { authenticated, isLoading: authLoading, refresh: refreshAuthRole } = useAuthRole();
  const [viewMode, setViewMode] = useState<ViewMode>("studio");
  const [isListCollapsed, setIsListCollapsed] = useState(false);
  const [authMode, setAuthMode] = useState<"supabase" | "gatekeeper" | "workflow" | null>(null);
  const [activeTask, setActiveTask] = useState<WidgetTask | null>(null);
  const [topTasks, setTopTasks] = useState<WidgetTask[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [loading, setLoading] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTaskPrompt, setShowTaskPrompt] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const shellRef = useRef<HTMLElement | null>(null);
  const expandedHeightRef = useRef(WIDGET_EXPANDED_HEIGHT);

  const notifyMainRefresh = useCallback(() => {
    const ipc = getIpcRenderer();
    ipc?.send(IPC_CHANNELS.REFRESH_MAIN);
  }, []);

  const resizeNativeWindow = useCallback((height: number, width?: number) => {
    const nextHeight = Math.max(180, Math.min(900, Math.ceil(height)));
    const ipc = getIpcRenderer();
    if (ipc) {
      ipc.send(IPC_CHANNELS.RESIZE_WIDGET, {
        height: nextHeight,
        ...(typeof width === "number" ? { width: Math.round(width) } : {}),
      });
      return;
    }
    try {
      window.resizeTo(typeof width === "number" ? Math.round(width) : window.outerWidth, nextHeight);
    } catch {
      // Browser may block window.resizeTo outside popup/PiP contexts.
    }
  }, []);

  const fitWindowToContent = useCallback(
    (collapsed: boolean) => {
      window.requestAnimationFrame(() => {
        const shell = shellRef.current;
        const measured = shell ? shell.offsetHeight + WIDGET_PAD_PX : 0;
        if (collapsed) {
          const nextHeight = measured > 0 ? measured : WIDGET_COLLAPSED_HEIGHT;
          resizeNativeWindow(nextHeight);
          return;
        }
        const nextHeight =
          measured > WIDGET_COLLAPSED_HEIGHT
            ? Math.max(measured, expandedHeightRef.current)
            : expandedHeightRef.current || WIDGET_EXPANDED_HEIGHT;
        expandedHeightRef.current = nextHeight;
        resizeNativeWindow(nextHeight);
      });
    },
    [resizeNativeWindow]
  );

  const toggleListCollapsed = useCallback(() => {
    setIsListCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        // Expanding: restore last expanded footprint.
        resizeNativeWindow(expandedHeightRef.current || WIDGET_EXPANDED_HEIGHT);
      }
      // Collapsing (and expanding after layout) measured in the effect below.
      return next;
    });
  }, [resizeNativeWindow]);

  const loadWidgetState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/studio-widget/tasks?limit=3&view=${viewMode}`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            mode?: "supabase" | "gatekeeper" | "workflow";
            userId?: string | null;
            activeTask?: ApiTaskRow | null;
            tasks?: ApiTaskRow[];
          }
        | null;

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error ?? `Failed to load widget tasks (${response.status}).`);
      }

      setAuthMode(json.mode ?? null);
      setUserId(json.userId ?? null);
      setActiveTask(json.activeTask ? mapRowToTask(json.activeTask, viewMode) : null);
      setTopTasks((json.tasks ?? []).map((row) => mapRowToTask(row, viewMode)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load widget tasks.");
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  const updateWidgetTaskStatus = useCallback(
    async (taskId: string, status: string, extra?: Record<string, unknown>) => {
      const response = await fetch("/api/studio-widget/tasks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-status",
          view: viewMode,
          taskId,
          status,
          extra: extra ?? {},
        }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !json?.ok) {
        return { ok: false as const, error: json?.error ?? `Update failed (${response.status}).` };
      }
      return { ok: true as const };
    },
    [viewMode]
  );

  useEffect(() => {
    fitWindowToContent(isListCollapsed);
  }, [fitWindowToContent, isListCollapsed, activeTask, topTasks.length, viewMode, loading, error]);

  useEffect(() => {
    const onResize = () => {
      if (isListCollapsed) {
        return;
      }
      expandedHeightRef.current = Math.max(WIDGET_COLLAPSED_HEIGHT, window.outerHeight || WIDGET_EXPANDED_HEIGHT);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isListCollapsed]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const handleFocus = () => {
      refreshAuthRole();
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.key.includes("auth-token")) {
        return;
      }
      refreshAuthRole();
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      refreshAuthRole();
    });

    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshAuthRole]);

  useEffect(() => {
    const tick = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!authenticated) {
      setUserId(null);
      setActiveTask(null);
      setTopTasks([]);
      setLoading(false);
      setError("Not signed in.");
      return;
    }

    setError(null);
    void loadWidgetState();
  }, [authLoading, authenticated, loadWidgetState]);

  useEffect(() => {
    const ipc = getIpcRenderer();
    if (!ipc) {
      return;
    }

    const listener = () => {
      if (authLoading || !authenticated) {
        return;
      }
      void loadWidgetState();
    };
    ipc.on(IPC_CHANNELS.REFRESH_EVENT, listener);
    return () => {
      ipc.removeListener(IPC_CHANNELS.REFRESH_EVENT, listener);
    };
  }, [authLoading, authenticated, loadWidgetState]);

  const activeElapsed = useMemo(() => {
    if (!activeTask) {
      return 0;
    }
    return getPlannerElapsedSeconds(activeTask.elapsedSeconds, activeTask.startedAtSec, nowSec);
  }, [activeTask, nowSec]);

  const handlePauseResume = async () => {
    if (!activeTask || busyTaskId) {
      return;
    }
    const previous = activeTask;
    setBusyTaskId(activeTask.id);
    setError(null);

    const currentNowSec = nowSec;

    if (viewMode === "workflow") {
      if (activeTask.isPaused || activeTask.startedAtSec === null) {
        const optimistic = {
          ...activeTask,
          status: "Editing",
          isPaused: false,
          startedAtSec: currentNowSec,
        };
        setActiveTask(optimistic);
        const res = await updateWidgetTaskStatus(activeTask.id, "Editing", {
          editing_started_at: new Date(currentNowSec * 1000).toISOString(),
        });
        if (!res.ok) {
          setActiveTask(previous);
          setError(res.error);
        } else {
          notifyMainRefresh();
          void loadWidgetState();
        }
      } else {
        const elapsed = getPlannerElapsedSeconds(
          activeTask.elapsedSeconds,
          activeTask.startedAtSec,
          currentNowSec
        );
        const optimistic = {
          ...activeTask,
          status: "Editing",
          isPaused: true,
          startedAtSec: null,
          elapsedSeconds: elapsed,
        };
        setActiveTask(optimistic);
        const res = await updateWidgetTaskStatus(activeTask.id, "Editing", {
          editing_started_at: null,
          total_editing_seconds: elapsed,
        });
        if (!res.ok) {
          setActiveTask(previous);
          setError(res.error);
        } else {
          notifyMainRefresh();
          void loadWidgetState();
        }
      }
      setBusyTaskId(null);
      return;
    }

    if (activeTask.isPaused || activeTask.startedAtSec === null) {
      const optimistic = {
        ...activeTask,
        status: "processing",
        isPaused: false,
        startedAtSec: currentNowSec,
      };
      setActiveTask(optimistic);
      const res = await updateWidgetTaskStatus(activeTask.id, "processing", {
        started_at: new Date(currentNowSec * 1000).toISOString(),
      });
      if (!res.ok) {
        setActiveTask(previous);
        setError(res.error);
      } else {
        notifyMainRefresh();
      }
    } else {
      const elapsed = getPlannerElapsedSeconds(
        activeTask.elapsedSeconds,
        activeTask.startedAtSec,
        currentNowSec
      );
      const optimistic = {
        ...activeTask,
        status: "planning",
        isPaused: true,
        startedAtSec: null,
        elapsedSeconds: elapsed,
      };
      setActiveTask(optimistic);
      const res = await updateWidgetTaskStatus(activeTask.id, "planning", {
        started_at: null,
        elapsed_seconds: elapsed,
        pause_reason: "Paused from timer widget",
      });
      if (!res.ok) {
        setActiveTask(previous);
        setError(res.error);
      } else {
        notifyMainRefresh();
      }
    }

    setBusyTaskId(null);
  };

  const handleStartOrPauseTask = async (task: WidgetTask) => {
    if (busyTaskId) {
      return;
    }

    const isActiveRunning =
      activeTask?.id === task.id && isTaskActivelyRunning(activeTask, viewMode);
    if (isActiveRunning || (activeTask?.id === task.id && !activeTask.isPaused && activeTask.startedAtSec)) {
      await handlePauseResume();
      return;
    }

    setBusyTaskId(task.id);
    setError(null);
    const previousTop = topTasks;
    const previousActive = activeTask;
    const now = nowSec;
    const nowIso = new Date(now * 1000).toISOString();

    if (viewMode === "workflow") {
      const optimisticTask: WidgetTask = {
        ...task,
        status: "Editing",
        startedAtSec: now,
        isPaused: false,
      };
      setTopTasks(topTasks.filter((item) => item.id !== task.id));
      setActiveTask(optimisticTask);

      const res = await updateWidgetTaskStatus(task.id, "Editing", {
        editing_started_at: nowIso,
      });
      if (!res.ok) {
        setTopTasks(previousTop);
        setActiveTask(previousActive);
        setError(res.error);
      } else {
        notifyMainRefresh();
        void loadWidgetState();
      }
      setBusyTaskId(null);
      return;
    }

    // Studio: Start Task moves into Processing (in progress) and starts the timer.
    const optimisticTask: WidgetTask = {
      ...task,
      status: "processing",
      startedAtSec: now,
      isPaused: false,
    };
    setTopTasks(
      topTasks.map((item) => (item.id === task.id ? optimisticTask : item)).slice(0, 3)
    );
    setActiveTask(optimisticTask);

    const res = await updateWidgetTaskStatus(task.id, "processing", {
      started_at: nowIso,
    });
    if (!res.ok) {
      setTopTasks(previousTop);
      setActiveTask(previousActive);
      setError(res.error);
    } else {
      notifyMainRefresh();
      void loadWidgetState();
    }

    setBusyTaskId(null);
  };

  const handleAddTask = () => {
    if (busyTaskId || viewMode !== "studio") {
      return;
    }
    setShowTaskPrompt(true);
  };

  const submitNewTask = async () => {
    if (busyTaskId || viewMode !== "studio") {
      return;
    }

    const title = newTaskTitle.trim();
    if (!title) {
      setError("Please enter a task title.");
      return;
    }

    setBusyTaskId("new");
    setError(null);

    const createRes = await fetch("/api/studio-widget/tasks", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        view: "studio",
        title,
        assignedTo: userId,
      }),
    });
    const createJson = (await createRes.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;

    if (!createRes.ok || !createJson?.ok) {
      setError(createJson?.error ?? `Could not create task (${createRes.status}).`);
      setBusyTaskId(null);
      return;
    }

    notifyMainRefresh();
    await loadWidgetState();
    setNewTaskTitle("");
    setShowTaskPrompt(false);
    setBusyTaskId(null);
  };

  const closeTaskPrompt = () => {
    setShowTaskPrompt(false);
    setNewTaskTitle("");
    setError(null);
  };

  const handleHideWidget = () => {
    const ipc = getIpcRenderer();
    ipc?.send(IPC_CHANNELS.HIDE_WIDGET);
  };

  const handleOpenMainApp = () => {
    const ipc = getIpcRenderer();
    ipc?.send(IPC_CHANNELS.FOCUS_MAIN);
  };

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === "studio" ? "workflow" : "studio"));
    setShowTaskPrompt(false);
    setError(null);
  };

  const headerTitle = viewMode === "studio" ? "Studio Widget" : "Workflow Widget";
  const listTitle = viewMode === "studio" ? "Top 3 Tasks" : "Next Tasks";
  const emptyListCopy =
    viewMode === "studio"
      ? "No assigned tasks available."
      : "No Ready for Review tasks available.";

  if (authLoading) {
    return (
      <main className="h-fit bg-transparent p-2 text-zinc-100">
        <section className="flex h-fit flex-col overflow-hidden rounded-2xl border border-white/20 bg-zinc-950/85 px-3 py-3 shadow-2xl backdrop-blur-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{headerTitle}</p>
          <p className="mt-2 text-sm text-zinc-200">Loading Auth...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="h-fit bg-transparent p-2 text-zinc-100">
      <section
        ref={shellRef}
        className="flex h-fit max-h-[min(900px,100vh)] min-h-[180px] w-full resize-y flex-col overflow-hidden rounded-2xl border border-white/20 bg-zinc-950/85 shadow-2xl backdrop-blur-lg"
      >
        <header
          className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2"
          style={dragStyle}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-300">{headerTitle}</p>
          <div className="flex items-center gap-1" style={noDragStyle}>
            <button
              type="button"
              onClick={toggleViewMode}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 text-zinc-200 transition hover:bg-zinc-800"
              aria-label={viewMode === "studio" ? "Switch to Workflow view" : "Switch to Studio view"}
              title={viewMode === "studio" ? "Switch to Workflow" : "Switch to Studio"}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleOpenMainApp}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 text-zinc-200 transition hover:bg-zinc-800"
              aria-label="Open main app"
              title="Open main app"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleHideWidget}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 text-zinc-200 transition hover:bg-zinc-800"
              aria-label="Hide widget"
              title="Hide"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <section className="shrink-0 rounded-xl border border-white/10 bg-zinc-900/90 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Active Task</p>
            {activeTask ? (
              <>
                <p className="mt-1 truncate text-sm font-semibold text-white" title={activeTask.title}>
                  {activeTask.title}
                </p>
                <p className="mt-2 font-mono text-2xl font-semibold">
                  {formatPlannerDuration(activeElapsed)}
                </p>
                <button
                  type="button"
                  onClick={() => void handlePauseResume()}
                  disabled={busyTaskId === activeTask.id}
                  className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/15 text-sm font-semibold text-amber-100 transition hover:border-amber-300/70 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                  style={noDragStyle}
                >
                  {activeTask.isPaused || activeTask.startedAtSec === null ? (
                    <Play className="h-4 w-4" />
                  ) : (
                    <Pause className="h-4 w-4" />
                  )}
                  {activeTask.isPaused || activeTask.startedAtSec === null ? "Start Task" : "Pause Task"}
                </button>
              </>
            ) : (
              <p className="mt-2 text-xs text-zinc-400">
                {viewMode === "workflow"
                  ? "No Editing task with an active timer."
                  : "No active timer right now."}
              </p>
            )}
          </section>

          <section className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-zinc-900/90 p-3">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  {listTitle}
                </p>
                <button
                  type="button"
                  onClick={toggleListCollapsed}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                  aria-label={isListCollapsed ? "Expand task list" : "Collapse task list"}
                  title={isListCollapsed ? "Expand" : "Collapse"}
                  style={noDragStyle}
                >
                  {isListCollapsed ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronUp className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              {viewMode === "studio" ? (
                <button
                  type="button"
                  onClick={() => void handleAddTask()}
                  disabled={!authenticated || busyTaskId === "new"}
                  className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                  style={noDragStyle}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Task
                </button>
              ) : null}
            </div>

            {!isListCollapsed ? (
              <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
                {topTasks.length === 0 && !loading ? (
                  <p className="text-xs text-zinc-400">{emptyListCopy}</p>
                ) : null}
                {topTasks.map((task) => {
                  const running =
                    activeTask?.id === task.id && isTaskActivelyRunning(activeTask, viewMode);
                  const label = running ? "Pause Task" : "Start Task";
                  return (
                    <article
                      key={task.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-2"
                    >
                      <p className="line-clamp-2 text-xs font-semibold text-zinc-100">{task.title}</p>
                      <button
                        type="button"
                        onClick={() => void handleStartOrPauseTask(task)}
                        disabled={busyTaskId === task.id}
                        className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 text-[11px] font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                        style={noDragStyle}
                      >
                        {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {label}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>

          {error ? <p className="shrink-0 text-xs text-red-300">{error}</p> : null}
          {authMode === "gatekeeper" && viewMode === "studio" ? (
            <p className="shrink-0 text-[10px] text-zinc-500">Gatekeeper mode — showing all studio tasks.</p>
          ) : null}
        </div>
      </section>

      {showTaskPrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3"
          style={noDragStyle}
        >
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl">
            <p className="text-sm font-semibold text-zinc-100">Add Task</p>
            <input
              type="text"
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitNewTask();
                }
                if (event.key === "Escape") {
                  closeTaskPrompt();
                }
              }}
              autoFocus
              placeholder="Task title"
              className="mt-2 h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/70"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeTaskPrompt}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitNewTask()}
                disabled={busyTaskId === "new"}
                className="inline-flex h-9 items-center justify-center rounded-md border border-emerald-400/40 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
