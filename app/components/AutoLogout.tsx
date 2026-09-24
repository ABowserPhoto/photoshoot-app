"use client";

import { useEffect, useRef } from "react";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import {
  ELECTRON_IPC,
  getIpcRenderer,
  isKeepAliveActive,
  type WidgetKeepAliveStatus,
} from "@/lib/electronIpc";
import {
  clearLastActiveTime,
  INACTIVITY_TIMEOUT_MS,
  readLastActiveTime,
  writeLastActiveTime,
} from "@/lib/supabaseClient";

const ACTIVITY_THROTTLE_MS = 60_000;
const CHECK_INTERVAL_MS = 60_000;

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

function isLocalIdleExpired(now = Date.now()): boolean {
  const lastActive = readLastActiveTime();
  if (lastActive === null) {
    return false;
  }
  return now - lastActive > INACTIVITY_TIMEOUT_MS;
}

function keepAliveFromArgs(args: unknown[]): WidgetKeepAliveStatus | null {
  for (const arg of args) {
    if (!arg || typeof arg !== "object") {
      continue;
    }
    const record = arg as Partial<WidgetKeepAliveStatus>;
    if (
      typeof record.visible === "boolean" ||
      typeof record.timerRunning === "boolean" ||
      typeof record.lastHeartbeatAt === "number"
    ) {
      return {
        visible: Boolean(record.visible),
        timerRunning: Boolean(record.timerRunning),
        lastHeartbeatAt:
          typeof record.lastHeartbeatAt === "number" && Number.isFinite(record.lastHeartbeatAt)
            ? record.lastHeartbeatAt
            : Date.now(),
      };
    }
  }
  return null;
}

export default function AutoLogout() {
  const { authenticated, isLoading, logout } = useAuthRole();
  const loggingOutRef = useRef(false);
  const lastActivityWriteRef = useRef(0);
  const keepAliveRef = useRef<WidgetKeepAliveStatus | null>(null);

  useEffect(() => {
    const forceLogout = async () => {
      if (loggingOutRef.current) {
        return;
      }
      loggingOutRef.current = true;
      clearLastActiveTime();
      try {
        await logout();
      } finally {
        loggingOutRef.current = false;
      }
    };

    const syncFromKeepAlive = (status: WidgetKeepAliveStatus | null, now = Date.now()) => {
      if (!status) {
        return;
      }
      keepAliveRef.current = status;
      if (!isKeepAliveActive(status, now)) {
        return;
      }
      const heartbeatAt = status.lastHeartbeatAt > 0 ? status.lastHeartbeatAt : now;
      const lastActive = readLastActiveTime() ?? 0;
      if (heartbeatAt > lastActive) {
        writeLastActiveTime(heartbeatAt);
        lastActivityWriteRef.current = heartbeatAt;
      }
    };

    const isIdleExpired = (now = Date.now()): boolean => {
      if (isKeepAliveActive(keepAliveRef.current, now)) {
        return false;
      }
      return isLocalIdleExpired(now);
    };

    if (!authenticated || isLoading) {
      return;
    }

    if (readLastActiveTime() === null) {
      writeLastActiveTime();
    }

    const ipc = getIpcRenderer();
    if (ipc) {
      void ipc
        .invoke(ELECTRON_IPC.KEEP_ALIVE_STATUS)
        .then((raw) => {
          if (loggingOutRef.current) {
            return;
          }
          syncFromKeepAlive(keepAliveFromArgs([raw]));
          if (isIdleExpired()) {
            void forceLogout();
          }
        })
        .catch(() => {
          if (isIdleExpired()) {
            void forceLogout();
          }
        });
    } else if (isIdleExpired()) {
      void forceLogout();
      return;
    }

    const checkIdle = () => {
      void (async () => {
        if (loggingOutRef.current) {
          return;
        }
        if (ipc) {
          try {
            const raw = await ipc.invoke(ELECTRON_IPC.KEEP_ALIVE_STATUS);
            syncFromKeepAlive(keepAliveFromArgs([raw]));
          } catch {
            // Fall back to the last heartbeat cached in this window.
          }
        }
        if (isIdleExpired()) {
          void forceLogout();
        }
      })();
    };

    const markActive = () => {
      if (loggingOutRef.current) {
        return;
      }
      if (isKeepAliveActive(keepAliveRef.current) || !isLocalIdleExpired()) {
        const now = Date.now();
        if (now - lastActivityWriteRef.current < ACTIVITY_THROTTLE_MS) {
          return;
        }
        lastActivityWriteRef.current = now;
        writeLastActiveTime(now);
        return;
      }
      if (ipc) {
        void checkIdle();
        return;
      }
      void forceLogout();
    };

    const onHeartbeat = (...args: unknown[]) => {
      syncFromKeepAlive(keepAliveFromArgs(args));
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }
    window.addEventListener("focus", checkIdle);
    document.addEventListener("visibilitychange", checkIdle);
    window.addEventListener("pageshow", checkIdle);
    ipc?.on(ELECTRON_IPC.HEARTBEAT, onHeartbeat);

    const intervalId = window.setInterval(checkIdle, CHECK_INTERVAL_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
      window.removeEventListener("focus", checkIdle);
      document.removeEventListener("visibilitychange", checkIdle);
      window.removeEventListener("pageshow", checkIdle);
      ipc?.removeListener(ELECTRON_IPC.HEARTBEAT, onHeartbeat);
      window.clearInterval(intervalId);
    };
  }, [authenticated, isLoading, logout]);

  return null;
}
