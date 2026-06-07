"use client";

import { useEffect, useRef } from "react";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import {
  clearLastActiveTime,
  INACTIVITY_TIMEOUT_MS,
  readLastActiveTime,
  writeLastActiveTime,
} from "@/lib/supabaseClient";

const ACTIVITY_THROTTLE_MS = 60_000;
const CHECK_INTERVAL_MS = 60_000;

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

function isIdleExpired(now = Date.now()): boolean {
  const lastActive = readLastActiveTime();
  if (lastActive === null) {
    return false;
  }
  return now - lastActive > INACTIVITY_TIMEOUT_MS;
}

export default function AutoLogout() {
  const { authenticated, isLoading, logout } = useAuthRole();
  const loggingOutRef = useRef(false);
  const lastActivityWriteRef = useRef(0);

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

    if (isIdleExpired()) {
      void forceLogout();
      return;
    }

    if (!authenticated || isLoading) {
      return;
    }

    if (readLastActiveTime() === null) {
      writeLastActiveTime();
    }

    const markActive = () => {
      const now = Date.now();
      if (now - lastActivityWriteRef.current < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastActivityWriteRef.current = now;
      writeLastActiveTime(now);
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }

    const intervalId = window.setInterval(() => {
      if (isIdleExpired()) {
        void forceLogout();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
      window.clearInterval(intervalId);
    };
  }, [authenticated, isLoading, logout]);

  return null;
}
