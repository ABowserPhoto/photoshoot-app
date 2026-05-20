"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { handleClockIn } from "@/app/actions/shifts";
import { supabase } from "@/lib/supabaseClient";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh: refreshAuthRole } = useAuthRole();
  const redirectTo = searchParams.get("redirect")?.trim() || "/";

  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const normalizedEmail = email.trim();

      if (normalizedEmail) {
        if (!supabase) {
          setError(
            "Supabase client is not configured. Use password-only Gatekeeper login, or set Supabase env vars."
          );
          return;
        }
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) {
          setError(signInError.message);
          return;
        }
        if (signInData.user?.id) {
          const clockInRes = await handleClockIn(signInData.user.id);
          if (!clockInRes.ok) {
            console.warn("[login clock-in]", clockInRes.error);
          }
        }
      } else {
        const res = await fetch("/api/auth/gate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) {
          setError(data?.error ?? `Sign-in failed (${res.status}).`);
          return;
        }
      }

      refreshAuthRole();
      const safeRedirect =
        redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/";
      router.replace(safeRedirect);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-8 shadow-xl">
        <h1 className="text-center text-xl font-semibold text-white">Sign in</h1>
        <p className="mt-2 text-center text-sm text-zinc-400">
          Enter your email and password, or use the app password to continue.
        </p>
        <form onSubmit={handleLogin} className="mt-8 space-y-4" noValidate>
          <label className="block text-sm font-medium text-zinc-300">
            Email (optional)
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none ring-zinc-500 focus:ring-2 disabled:opacity-60"
              placeholder="name@example.com"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-300">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none ring-zinc-500 focus:ring-2 disabled:opacity-60"
              required
            />
          </label>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-[#ffffff] px-4 py-2 font-semibold text-[#000000] transition-colors hover:bg-[#e5e7eb] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Signing In..." : "Sign In"}
          </button>
          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4">
          <p className="text-sm text-zinc-400">Loading…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
