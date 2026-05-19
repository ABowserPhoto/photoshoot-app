"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ActivePlannerTimerSnapshot = {
  taskId: string;
  title: string;
  startedAtSec: number | null;
  elapsedSeconds: number;
  isPaused: boolean;
  remainingSubtasks: number;
};

type PlannerGlobalContextValue = {
  activeTimerSession: ActivePlannerTimerSnapshot | null;
  setActiveTimerSession: (snapshot: ActivePlannerTimerSnapshot | null) => void;
  pauseHandlerRef: React.MutableRefObject<((taskId: string) => void) | null>;
};

const PlannerGlobalContext = createContext<PlannerGlobalContextValue | null>(null);

export function PlannerGlobalProvider({ children }: { children: ReactNode }) {
  const [activeTimerSession, setActiveTimerSessionState] = useState<ActivePlannerTimerSnapshot | null>(
    null
  );
  const pauseHandlerRef = useRef<((taskId: string) => void) | null>(null);

  const setActiveTimerSession = useCallback((snapshot: ActivePlannerTimerSnapshot | null) => {
    setActiveTimerSessionState(snapshot);
  }, []);

  const value = useMemo(
    () => ({
      activeTimerSession,
      setActiveTimerSession,
      pauseHandlerRef,
    }),
    [activeTimerSession, setActiveTimerSession]
  );

  return <PlannerGlobalContext.Provider value={value}>{children}</PlannerGlobalContext.Provider>;
}

export function usePlannerGlobal(): PlannerGlobalContextValue {
  const ctx = useContext(PlannerGlobalContext);
  if (!ctx) {
    throw new Error("usePlannerGlobal must be used within PlannerGlobalProvider");
  }
  return ctx;
}

export function usePlannerGlobalSafe(): PlannerGlobalContextValue | null {
  return useContext(PlannerGlobalContext);
}
