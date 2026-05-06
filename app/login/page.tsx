"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { supabase } from "@/lib/supabaseClient";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh: refreshAuthRole } = useAuthRole();
  const redirectTo = searchParams.get("redirect")?.trim() || "/";

  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim();

      if (normalizedEmail) {
        if (!supabase) {
          setError(
            "Supabase client is not configured. Use password-only Gatekeeper login, or set Supabase env vars."
          );
          return;
        }
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) {
          setError(signInError.message);
          return;
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
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-8 shadow-xl">
        <h1 className="text-center text-xl font-semibold text-white">Sign in</h1>
        <p className="mt-2 text-center text-sm text-zinc-400">
          Enter the app password to continue.
        </p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <label className="block text-sm font-medium text-zinc-300">
            Email (optional)
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none ring-zinc-500 focus:ring-2"
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
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none ring-zinc-500 focus:ring-2"
              required
            />
          </label>
          {error ? (
            <p className="text-sm text-zinc-400" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="flex h-10 w-full items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Continue"}
          </button>
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
