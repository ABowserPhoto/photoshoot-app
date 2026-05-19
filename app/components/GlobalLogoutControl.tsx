"use client";

import { LogOut } from "lucide-react";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";

type GlobalLogoutControlProps = {
  className?: string;
};

export default function GlobalLogoutControl({
  className = "inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-medium text-zinc-100 transition hover:bg-zinc-800 sm:px-4",
}: GlobalLogoutControlProps) {
  const { authenticated, isLoading, logout } = useAuthRole();

  if (isLoading || !authenticated) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => void logout()}
      className={className}
      aria-label="Logout"
    >
      <LogOut className="h-4 w-4 text-zinc-300" aria-hidden />
      Logout
    </button>
  );
}
