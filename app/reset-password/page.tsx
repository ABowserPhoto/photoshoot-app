"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Eye, EyeOff } from "lucide-react";
import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { handleClockIn } from "@/app/actions/shifts";
import { useAuthRole } from "@/app/contexts/AuthRoleContext";
import { ELECTRON_IPC, getIpcRenderer } from "@/lib/electronIpc";
import {
  classifyRecoveryArrival,
  FORGOT_PASSWORD_PATH,
  MIN_PASSWORD_LENGTH,
  passwordIssue,
  passwordIssueMessage,
  type RecoveryArrival,
} from "@/lib/passwordReset";
import { supabase } from "@/lib/supabaseClient";

type RecoveryStatus = "checking" | "ready" | "invalid" | "unconfigured";

const inputClassName =
  "w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 pr-11 text-sm text-white outline-none ring-zinc-500 focus:ring-2 disabled:opacity-60";

const buttonClassName =
  "w-full rounded-md bg-[#ffffff] px-4 py-2 font-semibold text-[#000000] transition-colors hover:bg-[#e5e7eb] disabled:cursor-not-allowed disabled:opacity-50";

const codeExchanges = new Map<string, Promise<boolean>>();

function establishRecovery(client: SupabaseClient, code: string): Promise<boolean> {
  const existing = codeExchanges.get(code);
  if (existing) return existing;

  const pending = (async () => {
    let sawRecovery = false;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") sawRecovery = true;
    });
    try {
      await client.auth.getSession();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      if (sawRecovery) return true;

      // detectSessionInUrl may already have exchanged this code and removed it.
      const codeStillPresent = new URL(window.location.href).searchParams.get("code") === code;
      if (!codeStillPresent) {
        const { data } = await client.auth.getUser();
        if (data.user) return true;
      }

      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return true;

      const { data } = await client.auth.getUser();
      return Boolean(data.user) && sawRecovery;
    } finally {
      subscription.unsubscribe();
    }
  })();

  codeExchanges.set(code, pending);
  return pending;
}

function PasswordField({
  id,
  name,
  label,
  showLabel,
  hideLabel,
  value,
  onChange,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  showLabel: string;
  hideLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block text-sm font-medium text-zinc-300" htmlFor={id}>
      {label}
      <div className="relative mt-1">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          minLength={MIN_PASSWORD_LENGTH}
          required
          className={inputClassName}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-zinc-400 transition-colors hover:text-white disabled:opacity-60"
          aria-label={visible ? hideLabel : showLabel}
          aria-controls={id}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </label>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh: refreshAuthRole } = useAuthRole();
  const search = searchParams.toString();
  const [status, setStatus] = useState<RecoveryStatus>(supabase ? "checking" : "unconfigured");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    const client = supabase;
    let active = true;
    let sawRecovery = false;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") sawRecovery = true;
    });

    async function resolveStatus(arrival: RecoveryArrival) {
      switch (arrival.kind) {
        case "invalid": {
          if (active) setStatus("invalid");
          return;
        }
        case "exchange": {
          const recovered = await establishRecovery(client, arrival.code);
          if (!active) return;
          if (!recovered) {
            setStatus("invalid");
            return;
          }
          const url = new URL(window.location.href);
          url.searchParams.delete("code");
          url.searchParams.set("recovery", "1");
          url.hash = "";
          window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
          setStatus("ready");
          return;
        }
        case "implicit": {
          await client.auth.getSession();
          await new Promise((resolve) => {
            setTimeout(resolve, 0);
          });
          if (!active) return;
          const hash = window.location.hash.startsWith("#")
            ? window.location.hash.slice(1)
            : window.location.hash;
          const hashType = new URLSearchParams(hash).get("type");
          const { data } = await client.auth.getUser();
          setStatus(data.user && (sawRecovery || hashType === "recovery") ? "ready" : "invalid");
          return;
        }
        case "session": {
          const { data } = await client.auth.getUser();
          if (!active) return;
          setStatus(data.user ? "ready" : "invalid");
          return;
        }
        default: {
          const unreachable: never = arrival;
          return unreachable;
        }
      }
    }

    const arrival = classifyRecoveryArrival(
      search ? `?${search}` : "",
      typeof window === "undefined" ? "" : window.location.hash
    );

    void resolveStatus(arrival).catch(() => {
      if (active) setStatus("invalid");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [search]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const issue = passwordIssue(password, confirmation);
    if (issue) {
      setError(passwordIssueMessage(issue));
      return;
    }
    if (!supabase) {
      setStatus("unconfigured");
      return;
    }

    setIsLoading(true);
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        const missingSession =
          updateError.code === "session_not_found" || /auth session missing/i.test(updateError.message);
        if (missingSession) {
          setStatus("invalid");
          return;
        }
        setError(updateError.message);
        return;
      }

      if (data.user?.id) {
        const clockInRes = await handleClockIn(data.user.id);
        if (!clockInRes.ok) {
          console.warn("[reset-password clock-in]", clockInRes.error);
        }
      }

      const sessionCheck = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "include",
      });
      const sessionJson = (await sessionCheck.json().catch(() => null)) as {
        authenticated?: boolean;
        error?: string;
      } | null;
      if (!sessionCheck.ok || !sessionJson?.authenticated) {
        setError(
          sessionJson?.error ??
            "Password updated, but the session cookie was not established. Try signing in."
        );
        return;
      }

      refreshAuthRole();
      getIpcRenderer()?.send(ELECTRON_IPC.SESSION_READY);
      router.replace("/");
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
        {status === "checking" ? (
          <p className="text-center text-sm text-zinc-400">Checking your reset link...</p>
        ) : status === "unconfigured" ? (
          <p className="text-center text-sm text-red-400" role="alert">
            Supabase client is not configured. Set Supabase env vars.
          </p>
        ) : status === "invalid" ? (
          <>
            <h1 className="text-center text-xl font-semibold text-white">Choose a new password</h1>
            <p className="mt-2 text-center text-sm text-red-400" role="alert">
              This reset link is invalid or has expired.
            </p>
            <div className="mt-8 space-y-4">
              <Link href={FORGOT_PASSWORD_PATH} className={`${buttonClassName} block text-center`}>
                Request a new link
              </Link>
              <Link
                href="/login"
                className="block text-center text-sm text-zinc-400 transition-colors hover:text-white"
              >
                Back to sign in
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-center text-xl font-semibold text-white">Choose a new password</h1>
            <p className="mt-2 text-center text-sm text-zinc-400">
              Enter a new password and confirm it.
            </p>
            <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
              <PasswordField
                id="new-password"
                name="password"
                label="New password"
                showLabel="Show new password"
                hideLabel="Hide new password"
                value={password}
                onChange={setPassword}
                disabled={isLoading}
              />
              <PasswordField
                id="confirm-password"
                name="confirmPassword"
                label="Confirm password"
                showLabel="Show password confirmation"
                hideLabel="Hide password confirmation"
                value={confirmation}
                onChange={setConfirmation}
                disabled={isLoading}
              />
              <button type="submit" disabled={isLoading} className={buttonClassName}>
                {isLoading ? "Updating..." : "Update password"}
              </button>
              {error ? (
                <p className="text-sm text-red-400" role="alert">
                  {error}
                </p>
              ) : null}
            </form>
          </>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4">
          <p className="text-sm text-zinc-400">Loading…</p>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
