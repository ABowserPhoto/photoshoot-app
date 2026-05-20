"use client";

import { useEffect, useRef } from "react";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";

const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 2500;
const CHECK_INTERVAL_MS = 60_000;

export default function SessionWatchdog() {
  const { user, logout } = useAuthRole();
  const lastActive = useRef(Date.now());
  const lastActivityWrite = useRef(0);

  useEffect(() => {
    if (!user) {
      return;
    }

    lastActive.current = Date.now();
    lastActivityWrite.current = Date.now();

    const markActive = () => {
      const now = Date.now();
      if (now - lastActivityWrite.current < ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastActivityWrite.current = now;
      lastActive.current = now;
    };

    const events = ["mousemove", "keydown", "scroll", "click"] as const;
    for (const event of events) {
      window.addEventListener(event, markActive, { passive: true });
    }

    const intervalId = window.setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_TIMEOUT_MS) {
        window.clearInterval(intervalId);
        void logout();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const event of events) {
        window.removeEventListener(event, markActive);
      }
      window.clearInterval(intervalId);
    };
  }, [user, logout]);

  return null;
}
