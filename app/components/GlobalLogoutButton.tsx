"use client";

import { LogOut } from "lucide-react";

import { useAuthRole } from "@/app/contexts/AuthRoleContext";

export default function GlobalLogoutButton() {
  const { authenticated, isLoading, logout } = useAuthRole();

  if (isLoading || !authenticated) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="fixed right-4 top-4 z-[90] inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-700 bg-black/90 px-3 text-sm font-medium text-zinc-100 backdrop-blur hover:bg-zinc-900"
      aria-label="Logout"
    >
      <LogOut className="h-4 w-4 text-zinc-300" aria-hidden />
      Logout
    </button>
  );
}
