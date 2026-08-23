"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { handleClockOut } from "@/app/actions/shifts";
import type { AppModule } from "@/lib/appModules";
import { canAccessModule } from "@/lib/appModules";
import type { UserRole } from "@/lib/authRole";
import { supabase } from "@/lib/supabaseClient";

type AuthUser = {
  id: string;
};

type AuthRoleState = {
  authenticated: boolean;
  user: AuthUser | null;
  role: UserRole;
  isAdmin: boolean;
  accessibleModules: AppModule[];
  isLoading: boolean;
  canAccess: (module: AppModule) => boolean;
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
  const [accessibleModules, setAccessibleModules] = useState<AppModule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!supabase) {
      console.error(
        "[AuthRole] Browser Supabase client is null. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel (Production + Preview), then redeploy so the client bundle picks them up."
      );
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
        const json = (await res.json().catch(() => null)) as {
          authenticated?: boolean;
          role?: UserRole | null;
          isAdmin?: boolean;
          accessibleModules?: AppModule[];
          error?: string;
        } | null;
        if (cancelled) {
          return;
        }
        if (json?.authenticated) {
          setAuthenticated(true);
          setRole(json.role ?? "editor");
          setIsAdmin(Boolean(json.isAdmin));
          setAccessibleModules(Array.isArray(json.accessibleModules) ? json.accessibleModules : []);
          if (!json.isAdmin && (!json.accessibleModules || json.accessibleModules.length === 0)) {
            console.warn(
              "[AuthRole] Authenticated without admin flag and with empty accessibleModules — CRM/Notes/Scripts nav may hide. Check profiles.role / SUPABASE_SERVICE_ROLE_KEY on Vercel."
            );
          }
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
          setAccessibleModules([]);
        }
      } catch (error) {
        console.error("[AuthRole] Failed to load auth role:", error);
        if (!cancelled) {
          setAuthenticated(false);
          setUser(null);
          setRole("editor");
          setIsAdmin(false);
          setAccessibleModules([]);
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
        credentials: "include",
      }).catch(() => null);
    } finally {
      setAuthenticated(false);
      setUser(null);
      setRole("editor");
      setIsAdmin(false);
      setAccessibleModules([]);
      setIsLoading(false);
      router.push("/login");
      router.refresh();
    }
  }, [router]);

  const canAccess = useCallback(
    (module: AppModule) => canAccessModule({ isAdmin, accessibleModules, module }),
    [isAdmin, accessibleModules]
  );

  const value = useMemo(
    () => ({
      authenticated,
      user,
      role,
      isAdmin,
      accessibleModules,
      isLoading,
      canAccess,
      refresh,
      logout,
    }),
    [
      authenticated,
      user,
      role,
      isAdmin,
      accessibleModules,
      isLoading,
      canAccess,
      refresh,
      logout,
    ]
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
