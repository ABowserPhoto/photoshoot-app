"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { UserRole } from "@/lib/authRole";
import { handleClockOut } from "@/app/actions/shifts";
import { supabase } from "@/lib/supabaseClient";

type AuthUser = {
  id: string;
};

type AuthRoleState = {
  authenticated: boolean;
  user: AuthUser | null;
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
  const [user, setUser] = useState<AuthUser | null>(null);
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
          if (supabase) {
            const {
              data: { user: sessionUser },
            } = await supabase.auth.getUser();
            setUser(sessionUser ? { id: sessionUser.id } : null);
          } else {
            setUser(null);
          }
        } else {
          setAuthenticated(false);
          setUser(null);
          setRole("editor");
          setIsAdmin(false);
        }
      } catch {
        if (!cancelled) {
          setAuthenticated(false);
          setUser(null);
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
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user?.id) {
          const clockOutRes = await handleClockOut(user.id);
          if (!clockOutRes.ok) {
            console.warn("[logout clock-out]", clockOutRes.error);
          }
        }
        await supabase.auth.signOut();
      }
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => null);
    } finally {
      setAuthenticated(false);
      setUser(null);
      setRole("editor");
      setIsAdmin(false);
      setIsLoading(false);
      router.push("/login");
      router.refresh();
    }
  }, [router]);

  const value = useMemo(
    () => ({ authenticated, user, role, isAdmin, isLoading, refresh, logout }),
    [authenticated, user, role, isAdmin, isLoading, refresh, logout]
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

export function useAuthRoleSafe(): AuthRoleState | null {
  return useContext(AuthRoleContext);
}
