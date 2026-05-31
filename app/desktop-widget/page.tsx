"use client";

import { createBrowserClient } from "@supabase/ssr";
import { ExternalLink, Pause, Play, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";

import { formatPlannerDuration, getPlannerElapsedSeconds } from "@/lib/plannerTimerUtils";

type WidgetTaskStatus = "master" | "planning" | "processing" | "completed";

type WidgetTask = {
  id: string;
  title: string;
  status: WidgetTaskStatus;
  startedAtSec: number | null;
  elapsedSeconds: number;
  isPaused: boolean;
};

type StudioTaskRow = {
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
} as const;

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
  const electron = (window as typeof window & { require?: (name: string) => unknown }).require?.("electron") as
    | { ipcRenderer?: ReturnType<typeof getIpcRenderer> }
    | undefined;
  return electron?.ipcRenderer ?? null;
}

function normalizeStatus(value: string | null | undefined): WidgetTaskStatus {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "planning" || normalized === "processing" || normalized === "completed") {
    return normalized;
  }
  return "master";
}

function mapRowToTask(row: StudioTaskRow): WidgetTask {
  const startedAtMs = row.started_at ? new Date(row.started_at).getTime() : Number.NaN;
  const startedAtSec = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
  const status = normalizeStatus(row.status);
  const elapsedSeconds = Math.max(0, row.elapsed_seconds ?? 0);
  return {
    id: String(row.id),
    title: row.title?.trim() || "Untitled Task",
    status,
    startedAtSec,
    elapsedSeconds,
    isPaused: status === "processing" && startedAtSec === null && elapsedSeconds > 0,
  };
}

function getPrimaryAction(status: WidgetTaskStatus): { label: string; nextStatus: WidgetTaskStatus } | null {
  if (status === "master") {
    return { label: "Start Task", nextStatus: "planning" };
  }
  if (status === "planning") {
    return { label: "Move to Editing", nextStatus: "processing" };
  }
  if (status === "processing") {
    return { label: "Move to Ready for Review", nextStatus: "completed" };
  }
  return null;
}

export default function DesktopWidgetPage() {
  const widgetSupabase = useMemo(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !supabaseAnonKey) {
      return null;
    }
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  }, []);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"supabase" | "gatekeeper" | null>(null);
  const [activeTask, setActiveTask] = useState<WidgetTask | null>(null);
  const [topTasks, setTopTasks] = useState<WidgetTask[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [loading, setLoading] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notifyMainRefresh = useCallback(() => {
    const ipc = getIpcRenderer();
    ipc?.send(IPC_CHANNELS.REFRESH_MAIN);
  }, []);

  useEffect(() => {
    console.log("[Widget Auth] Context User ID:", null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const authSubscriptionRef: MutableRefObject<{ unsubscribe: () => void } | null> = { current: null };

    const initializeAndListen = async () => {
      if (!widgetSupabase) {
        console.log("[Widget Auth] Browser client unavailable (missing env vars).");
        if (!cancelled) {
          setAuthReady(true);
        }
        return;
      }

      try {
        const { data } = await widgetSupabase.auth.getSession();
        console.log("[Widget Auth] Initial session:", data.session);
        if (!cancelled) {
          const nextUserId = data.session?.user?.id ?? null;
          setSessionUserId(nextUserId);
          setAuthMode(nextUserId ? "supabase" : null);
          setAuthReady(true);
        }
      } catch {
        if (!cancelled) {
          setSessionUserId(null);
          setAuthReady(true);
        }
      }

      if (cancelled) {
        return;
      }

      const {
        data: { subscription },
      } = widgetSupabase.auth.onAuthStateChange((event, session) => {
        console.log("[Widget Auth] Auth state changed:", event, session?.user?.id);
        if (cancelled) {
          return;
        }
        const nextUserId = session?.user?.id ?? null;
        setSessionUserId(nextUserId);
        setAuthMode(nextUserId ? "supabase" : null);
        setAuthReady(true);
      });
      authSubscriptionRef.current = subscription;
    };

    void initializeAndListen();
    return () => {
      cancelled = true;
      authSubscriptionRef.current?.unsubscribe();
    };
  }, [widgetSupabase]);

  const resolveCurrentUserId = useCallback(async (): Promise<string | null> => {
    if (sessionUserId) {
      console.log("[Widget Auth] User source: session-state", sessionUserId);
      return sessionUserId;
    }

    if (!widgetSupabase) {
      console.log("[Widget Auth] User source: none (client unavailable)");
      return null;
    }

    const { data: sessionData } = await widgetSupabase.auth.getSession();
    const fromSession = sessionData.session?.user?.id ?? null;
    if (fromSession) {
      console.log("[Widget Auth] User source: getSession", fromSession);
      return fromSession;
    }

    const { data: userData } = await widgetSupabase.auth.getUser();
    const fromGetUser = userData.user?.id ?? null;
    console.log("[Widget Auth] User source: getUser", fromGetUser);
    return fromGetUser;
  }, [sessionUserId, widgetSupabase]);
  const loadWidgetState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/studio-widget/tasks?limit=3", {
        cache: "no-store",
        credentials: "include",
      });
      const json = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            mode?: "supabase" | "gatekeeper";
            userId?: string | null;
            activeTask?: StudioTaskRow | null;
            tasks?: StudioTaskRow[];
          }
        | null;

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error ?? `Failed to load widget tasks (${response.status}).`);
      }

      const nextMode = json.mode ?? null;
      const nextUserId = json.userId ?? null;
      setAuthMode(nextMode);
      setUserId(nextUserId);
      const nextActive = json.activeTask ? mapRowToTask(json.activeTask) : null;
      setActiveTask(nextActive);
      setTopTasks((json.tasks ?? []).map(mapRowToTask));

      if (nextMode === "gatekeeper") {
        console.log("[Widget Auth] User source: gatekeeper-api", nextUserId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load widget tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  const updateWidgetTaskStatus = useCallback(
    async (taskId: string, status: WidgetTaskStatus, extra?: Record<string, unknown>) => {
      const response = await fetch("/api/studio-widget/tasks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-status",
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
    []
  );

  useEffect(() => {
    if (!widgetSupabase) {
      return;
    }

    const handleFocus = () => {
      void widgetSupabase.auth.getSession().then(({ data }) => {
        const nextUserId = data.session?.user?.id ?? null;
        console.log("[Widget Auth] Focus session sync:", nextUserId);
        setSessionUserId(nextUserId);
        setAuthReady(true);
      });
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.key.includes("auth-token")) {
        return;
      }
      void widgetSupabase.auth.getSession().then(({ data }) => {
        const nextUserId = data.session?.user?.id ?? null;
        console.log("[Widget Auth] Storage session sync:", nextUserId);
        setSessionUserId(nextUserId);
        setAuthReady(true);
      });
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
    };
  }, [widgetSupabase]);

  useEffect(() => {
    const tick = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    void (async () => {
      await Promise.resolve();
      const sessionUid = await resolveCurrentUserId();
      if (sessionUid) {
        setSessionUserId(sessionUid);
      }

      const sessionExists = Boolean(sessionUid || sessionUserId);
      if (!sessionExists) {
        const authRes = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" }).catch(
          () => null
        );
        if (authRes?.ok) {
          setAuthMode("gatekeeper");
          await loadWidgetState();
          return;
        }
      }

      if (!sessionExists && authMode !== "gatekeeper") {
        setUserId(null);
        setActiveTask(null);
        setTopTasks([]);
        setLoading(false);
        setError("Not signed in.");
        return;
      }

      await loadWidgetState();
    })();
  }, [authReady, sessionUserId, authMode, resolveCurrentUserId, loadWidgetState]);

  useEffect(() => {
    const ipc = getIpcRenderer();
    if (!ipc) {
      return;
    }

    const listener = () => {
      if (!authReady) {
        return;
      }
      void loadWidgetState();
    };
    ipc.on(IPC_CHANNELS.REFRESH_EVENT, listener);
    return () => {
      ipc.removeListener(IPC_CHANNELS.REFRESH_EVENT, listener);
    };
  }, [authReady, loadWidgetState]);

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
    if (activeTask.isPaused) {
      const optimistic = { ...activeTask, isPaused: false, startedAtSec: currentNowSec };
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
      const elapsed = getPlannerElapsedSeconds(activeTask.elapsedSeconds, activeTask.startedAtSec, currentNowSec);
      const optimistic = { ...activeTask, isPaused: true, startedAtSec: null, elapsedSeconds: elapsed };
      setActiveTask(optimistic);
      const res = await updateWidgetTaskStatus(activeTask.id, "processing", {
        started_at: null,
        elapsed_seconds: elapsed,
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

  const handleAdvanceTask = async (task: WidgetTask) => {
    const action = getPrimaryAction(task.status);
    if (!action || busyTaskId) {
      return;
    }

    setBusyTaskId(task.id);
    setError(null);
    const previousTop = topTasks;
    const previousActive = activeTask;
    const now = nowSec;
    const nowIso = new Date(now * 1000).toISOString();

    let extra: Record<string, unknown> = {};
    let optimisticTask: WidgetTask = { ...task, status: action.nextStatus };

    if (action.nextStatus === "processing") {
      optimisticTask = { ...optimisticTask, startedAtSec: now, isPaused: false };
      extra = { started_at: nowIso };
    }

    if (task.status === "processing" && action.nextStatus !== "processing") {
      const elapsed = getPlannerElapsedSeconds(task.elapsedSeconds, task.startedAtSec, now);
      optimisticTask = { ...optimisticTask, startedAtSec: null, elapsedSeconds: elapsed, isPaused: false };
      extra = { ...extra, elapsed_seconds: elapsed, started_at: null };
    }

    if (action.nextStatus === "completed") {
      extra = { ...extra, completed_at: nowIso };
    }

    const optimisticList = topTasks
      .map((item) => (item.id === task.id ? optimisticTask : item))
      .filter((item) => item.status !== "completed")
      .slice(0, 3);
    setTopTasks(optimisticList);
    if (activeTask?.id === task.id) {
      setActiveTask(optimisticTask.status === "completed" ? null : optimisticTask);
    }

    const res = await updateWidgetTaskStatus(task.id, action.nextStatus, extra);
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

  const handleAddTask = async () => {
    if (busyTaskId) {
      return;
    }
    const title = window.prompt("Task title");
    if (!title || !title.trim()) {
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
        title: title.trim(),
        assignedTo: userId,
      }),
    });
    const createJson = (await createRes.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

    if (!createRes.ok || !createJson?.ok) {
      setError(createJson?.error ?? `Could not create task (${createRes.status}).`);
      setBusyTaskId(null);
      return;
    }

    notifyMainRefresh();
    await loadWidgetState();
    setBusyTaskId(null);
  };

  const handleHideWidget = () => {
    const ipc = getIpcRenderer();
    ipc?.send(IPC_CHANNELS.HIDE_WIDGET);
  };

  const handleOpenMainApp = () => {
    const ipc = getIpcRenderer();
    ipc?.send(IPC_CHANNELS.FOCUS_MAIN);
  };

  if (!authReady) {
    return (
      <main className="min-h-screen bg-transparent p-2 text-zinc-100">
        <section className="flex h-[434px] flex-col rounded-2xl border border-white/20 bg-zinc-950/85 px-3 py-3 shadow-2xl backdrop-blur-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Studio Widget</p>
          <p className="mt-2 text-sm text-zinc-200">Loading Auth...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-transparent p-2 text-zinc-100">
      <style jsx global>{`
        footer {
          display: none !important;
        }
      `}</style>
      <section className="flex h-[434px] flex-col rounded-2xl border border-white/20 bg-zinc-950/85 shadow-2xl backdrop-blur-lg">
        <header
          className="flex items-center justify-between border-b border-white/10 px-3 py-2"
          style={{ WebkitAppRegion: "drag" }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-300">Studio Widget</p>
          <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" }}>
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

        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <section className="rounded-xl border border-white/10 bg-zinc-900/90 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Active Task</p>
            {activeTask ? (
              <>
                <p className="mt-1 truncate text-sm font-semibold text-white" title={activeTask.title}>
                  {activeTask.title}
                </p>
                <p className="mt-2 font-mono text-2xl font-semibold">{formatPlannerDuration(activeElapsed)}</p>
                <button
                  type="button"
                  onClick={() => void handlePauseResume()}
                  disabled={busyTaskId === activeTask.id}
                  className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/15 text-sm font-semibold text-amber-100 transition hover:border-amber-300/70 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ WebkitAppRegion: "no-drag" }}
                >
                  {activeTask.isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {activeTask.isPaused ? "Resume" : "Pause"}
                </button>
              </>
            ) : (
              <p className="mt-2 text-xs text-zinc-400">No active timer right now.</p>
            )}
          </section>

          <section className="rounded-xl border border-white/10 bg-zinc-900/90 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Top 3 Tasks</p>
              <button
                type="button"
                onClick={() => void handleAddTask()}
                disabled={!userId || busyTaskId === "new"}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ WebkitAppRegion: "no-drag" }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Task
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {topTasks.length === 0 && !loading ? (
                <p className="text-xs text-zinc-400">No assigned tasks available.</p>
              ) : null}
              {topTasks.map((task) => {
                const action = getPrimaryAction(task.status);
                return (
                  <article key={task.id} className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-2">
                    <p className="line-clamp-2 text-xs font-semibold text-zinc-100">{task.title}</p>
                    {action ? (
                      <button
                        type="button"
                        onClick={() => void handleAdvanceTask(task)}
                        disabled={busyTaskId === task.id}
                        className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-[11px] font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ WebkitAppRegion: "no-drag" }}
                      >
                        {action.label}
                      </button>
                    ) : (
                      <p className="mt-2 text-[11px] text-zinc-500">Complete</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {error ? <p className="text-xs text-red-300">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
