"use client";

import { Pause } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { usePlannerGlobalSafe } from "@/app/contexts/PlannerGlobalContext";
import type { ActivePlannerTimerSnapshot } from "@/app/contexts/PlannerGlobalContext";
import { JIBBLE_BREAK_PAUSED_EVENT } from "@/app/components/JibbleClockToggle";
import { formatPlannerDuration, getPlannerElapsedSeconds } from "@/lib/plannerTimerUtils";
import { pauseStudioTaskFromRemote } from "@/lib/plannerRemotePause";
import { supabase } from "@/lib/supabaseClient";

type StudioWidgetActiveRow = {
  id: string;
  title: string | null;
  status: string | null;
  started_at: string | null;
  elapsed_seconds: number | null;
  assigned_to?: string | null;
  subtasks?: unknown;
};

function countRemainingSubtasks(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((item) => {
    if (!item || typeof item !== "object") return true;
    return !(item as { isCompleted?: unknown }).isCompleted;
  }).length;
}

function mapActiveRow(row: StudioWidgetActiveRow): ActivePlannerTimerSnapshot | null {
  const startedAtMs = row.started_at ? new Date(row.started_at).getTime() : Number.NaN;
  const startedAtSec = Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
  if (!startedAtSec) return null;
  return {
    taskId: String(row.id),
    title: row.title?.trim() || "Untitled Task",
    startedAtSec,
    elapsedSeconds: Math.max(0, row.elapsed_seconds ?? 0),
    isPaused: false,
    remainingSubtasks: countRemainingSubtasks(row.subtasks),
  };
}

export default function GlobalActiveTaskWidget() {
  const ctx = usePlannerGlobalSafe();
  const [, setTick] = useState(0);
  const [remoteSession, setRemoteSession] = useState<ActivePlannerTimerSnapshot | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const pauseHandlerRef = ctx?.pauseHandlerRef;
  const setActiveTimerSession = ctx?.setActiveTimerSession;
  const contextSession = ctx?.activeTimerSession ?? null;

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      setSessionUserId(data.user?.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadRemoteActiveTask = useCallback(async () => {
    // Prefer planner-driven context while the planner board is mounted.
    if (pauseHandlerRef?.current) {
      return;
    }
    try {
      const response = await fetch("/api/studio-widget/tasks?limit=1", {
        cache: "no-store",
        credentials: "include",
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; activeTask?: StudioWidgetActiveRow | null; userId?: string | null }
        | null;
      if (!response.ok || !json?.ok) {
        return;
      }
      if (json.userId) {
        setSessionUserId(json.userId);
      }
      const mapped = json.activeTask ? mapActiveRow(json.activeTask) : null;
      setRemoteSession(mapped);
      if (setActiveTimerSession) {
        setActiveTimerSession(mapped);
      }
    } catch {
      // Ignore transient network errors for the floating widget.
    }
  }, [pauseHandlerRef, setActiveTimerSession]);

  useEffect(() => {
    void loadRemoteActiveTask();
    const id = window.setInterval(() => {
      void loadRemoteActiveTask();
    }, 5000);
    return () => window.clearInterval(id);
  }, [loadRemoteActiveTask]);

  useEffect(() => {
    const handleJibbleBreak = () => {
      setRemoteSession(null);
      setActiveTimerSession?.(null);
    };
    window.addEventListener(JIBBLE_BREAK_PAUSED_EVENT, handleJibbleBreak);
    return () => {
      window.removeEventListener(JIBBLE_BREAK_PAUSED_EVENT, handleJibbleBreak);
    };
  }, [setActiveTimerSession]);

  // Realtime: only react to changes on the signed-in user's tasks.
  useEffect(() => {
    if (!supabase || !sessionUserId) return;

    const channel = supabase
      .channel(`studio-widget-active:${sessionUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "studio_tasks" },
        (payload) => {
          if (pauseHandlerRef?.current) return;
          const row = (payload.new ?? payload.old) as {
            assigned_to?: string | null;
            assigned_users?: unknown;
          } | null;
          if (!row) {
            void loadRemoteActiveTask();
            return;
          }
          const assignedTo =
            typeof row.assigned_to === "string" ? row.assigned_to.trim() : "";
          const users = Array.isArray(row.assigned_users) ? row.assigned_users : [];
          const mentioned =
            assignedTo === sessionUserId ||
            users.some(
              (u) =>
                u &&
                typeof u === "object" &&
                typeof (u as { id?: unknown }).id === "string" &&
                (u as { id: string }).id === sessionUserId
            );
          if (mentioned) {
            void loadRemoteActiveTask();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionUserId, loadRemoteActiveTask, pauseHandlerRef]);

  if (!ctx) {
    return null;
  }

  const activeTimerSession = pauseHandlerRef?.current ? contextSession : contextSession ?? remoteSession;

  if (!activeTimerSession || activeTimerSession.isPaused || activeTimerSession.startedAtSec === null) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const elapsed = getPlannerElapsedSeconds(
    activeTimerSession.elapsedSeconds,
    activeTimerSession.startedAtSec,
    nowSec
  );

  const handlePause = () => {
    const localPause = pauseHandlerRef?.current;
    if (localPause) {
      localPause(activeTimerSession.taskId);
      return;
    }
    void (async () => {
      try {
        await pauseStudioTaskFromRemote(activeTimerSession.taskId);
        setRemoteSession(null);
        setActiveTimerSession?.(null);
      } catch {
        window.alert("Could not pause this task. Open the Studio Planner or check your connection.");
      }
    })();
  };

  return (
    <div
      className="fixed bottom-6 right-6 z-[999] w-72 rounded-xl border border-white/10 bg-neutral-900/90 p-4 shadow-2xl backdrop-blur-md"
      role="status"
      aria-label="Active task timer"
    >
      <p className="truncate text-xs font-medium uppercase tracking-wide text-white/50">Active task</p>
      <p className="mt-1 truncate text-sm font-semibold text-white" title={activeTimerSession.title}>
        {activeTimerSession.title}
      </p>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-white">
        {formatPlannerDuration(elapsed)}
      </p>
      <p className="mt-1 text-xs text-white/70">
        {activeTimerSession.remainingSubtasks === 0
          ? "All subtasks done"
          : `${activeTimerSession.remainingSubtasks} subtasks remaining`}
      </p>
      <button
        type="button"
        onClick={handlePause}
        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/15 text-sm font-semibold text-amber-100 transition hover:border-amber-300/60 hover:bg-amber-500/25"
      >
        <Pause className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        Pause
      </button>
    </div>
  );
}
