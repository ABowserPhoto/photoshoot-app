"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { UserRole } from "@/lib/authRole";
import { supabase } from "@/lib/supabaseClient";

type AuthRoleState = {
  authenticated: boolean;
  role: UserRole;
  isAdmin: boolean;
  isLoading: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
};

const AuthRoleContext = createContext<AuthRoleState | null>(null);

export function AuthRoleProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<UserRole>("editor");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as {
          authenticated?: boolean;
          role?: UserRole;
          isAdmin?: boolean;
        } | null;
        if (cancelled) {
          return;
        }
        if (res.ok && json?.authenticated) {
          setAuthenticated(true);
          setRole(json.role ?? "editor");
          setIsAdmin(Boolean(json.isAdmin));
        } else {
          setAuthenticated(false);
          setRole("editor");
          setIsAdmin(false);
        }
      } catch {
        if (!cancelled) {
          setAuthenticated(false);
          setRole("editor");
          setIsAdmin(false);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => null);
    } finally {
      setAuthenticated(false);
      setRole("editor");
      setIsAdmin(false);
      setIsLoading(false);
      router.push("/login");
      router.refresh();
    }
  }, [router]);

  const value = useMemo(
    () => ({ authenticated, role, isAdmin, isLoading, refresh, logout }),
    [authenticated, role, isAdmin, isLoading, refresh, logout]
  );

  return <AuthRoleContext.Provider value={value}>{children}</AuthRoleContext.Provider>;
}

export function useAuthRole(): AuthRoleState {
  const ctx = useContext(AuthRoleContext);
  if (!ctx) {
    throw new Error("useAuthRole must be used within AuthRoleProvider");
  }
  return ctx;
}
