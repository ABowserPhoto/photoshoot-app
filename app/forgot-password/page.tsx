"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import {
  passwordResetRedirectUrl,
  RESET_LINK_SENT_MESSAGE,
} from "@/lib/passwordReset";
import { supabase } from "@/lib/supabaseClient";

const inputClassName =
  "mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white outline-none ring-zinc-500 focus:ring-2 disabled:opacity-60";

const buttonClassName =
  "w-full rounded-md bg-[#ffffff] px-4 py-2 font-semibold text-[#000000] transition-colors hover:bg-[#e5e7eb] disabled:cursor-not-allowed disabled:opacity-50";

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedEmail = email.trim();
    if (!isEmailAddress(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    const redirectTo = passwordResetRedirectUrl(window.location.origin);
    if (!supabase || !redirectTo) {
      setError("Supabase client is not configured. Set Supabase env vars.");
      return;
    }

    setIsLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });
      if (resetError) {
        console.error("[password-reset] Reset email was not confirmed.");
      }
    } catch {
      console.error("[password-reset] Reset email request failed.");
    } finally {
      setIsLoading(false);
      setSent(true);
    }
  }

  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-8 shadow-xl">
        <h1 className="text-center text-xl font-semibold text-white">Forgot password</h1>
        {sent ? (
          <div className="mt-8 space-y-4">
            <p className="text-center text-sm text-zinc-300" role="status">
              {RESET_LINK_SENT_MESSAGE}
            </p>
            <Link href="/login" className={`${buttonClassName} block text-center`}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-2 text-center text-sm text-zinc-400">
              Enter the email on your account. We will email a reset link.
            </p>
            <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
              <label className="block text-sm font-medium text-zinc-300">
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isLoading}
                  className={inputClassName}
                  placeholder="name@example.com"
                  required
                />
              </label>
              <button type="submit" disabled={isLoading} className={buttonClassName}>
                {isLoading ? "Sending..." : "Send reset link"}
              </button>
              {error ? (
                <p className="text-sm text-red-400" role="alert">
                  {error}
                </p>
              ) : null}
              <Link
                href="/login"
                className="block text-center text-sm text-zinc-400 transition-colors hover:text-white"
              >
                Back to sign in
              </Link>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
