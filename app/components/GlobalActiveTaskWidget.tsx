"use client";

import { Pause } from "lucide-react";
import { useEffect, useState } from "react";

import { usePlannerGlobalSafe } from "@/app/contexts/PlannerGlobalContext";
import { formatPlannerDuration, getPlannerElapsedSeconds } from "@/lib/plannerTimerUtils";
import { pauseStudioTaskFromRemote } from "@/lib/plannerRemotePause";

export default function GlobalActiveTaskWidget() {
  const ctx = usePlannerGlobalSafe();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!ctx) {
    return null;
  }

  const { activeTimerSession, pauseHandlerRef } = ctx;

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
    const localPause = pauseHandlerRef.current;
    if (localPause) {
      localPause(activeTimerSession.taskId);
      return;
    }
    void (async () => {
      try {
        await pauseStudioTaskFromRemote(activeTimerSession.taskId);
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
