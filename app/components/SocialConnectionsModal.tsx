"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  disconnectInstagram,
  disconnectInstagramAccount,
  disconnectTikTok,
  getInstagramConnections,
  type InstagramConnectedAccount,
} from "@/app/actions/social-profiles";
import type { SchedulerSocialProfileRow } from "@/lib/schedulerSocialProfile";
import { openExternalUrl } from "@/lib/openExternalUrl";

type SocialConnectionsModalProps = {
  open: boolean;
  onClose: () => void;
  activeProfileId: string | null;
  activeProfile: SchedulerSocialProfileRow | null;
  hasSupabase: boolean;
  metaOAuthHref: string | null;
  onConnectionsChanged: () => void;
  onProfilesPatched: (updater: (prev: SchedulerSocialProfileRow[]) => SchedulerSocialProfileRow[]) => void;
};

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        connected ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" : "bg-zinc-500"
      }`}
      title={connected ? "Connected" : "Not connected"}
      aria-hidden
    />
  );
}

function instagramLabel(account: InstagramConnectedAccount): string {
  if (account.igUsername?.trim()) {
    return `@${account.igUsername.replace(/^@/, "")}`;
  }
  return account.pageName?.trim() || account.igAccountId;
}

export default function SocialConnectionsModal({
  open,
  onClose,
  activeProfileId,
  activeProfile,
  hasSupabase,
  metaOAuthHref,
  onConnectionsChanged,
  onProfilesPatched,
}: SocialConnectionsModalProps) {
  const [busy, setBusy] = useState<"ig-all" | "tt" | string | null>(null);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramConnectedAccount[]>([]);
  const [loadingInstagram, setLoadingInstagram] = useState(false);
  const onConnectionsChangedRef = useRef(onConnectionsChanged);
  onConnectionsChangedRef.current = onConnectionsChanged;

  const loadInstagramAccounts = useCallback(async () => {
    if (!activeProfileId || !hasSupabase) {
      setInstagramAccounts([]);
      return;
    }
    setLoadingInstagram(true);
    try {
      const result = await getInstagramConnections(activeProfileId);
      if (!result.ok) {
        setInstagramAccounts([]);
        return;
      }
      setInstagramAccounts(result.accounts);
    } finally {
      setLoadingInstagram(false);
    }
  }, [activeProfileId, hasSupabase]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadInstagramAccounts();
  }, [open, loadInstagramAccounts]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const refreshOnFocus = () => {
      onConnectionsChangedRef.current();
      void loadInstagramAccounts();
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [open, loadInstagramAccounts]);

  if (!open) {
    return null;
  }

  const igConnected = instagramAccounts.length > 0;
  const ttConnected =
    typeof activeProfile?.tiktok_access_token === "string" &&
    activeProfile.tiktok_access_token.trim().length > 0;

  const patchProfileAfterInstagramChange = (accounts: InstagramConnectedAccount[]) => {
    if (!activeProfileId) {
      return;
    }
    const active = accounts.find((account) => account.isActive) ?? accounts[0] ?? null;
    onProfilesPatched((prev) =>
      prev.map((p) =>
        p.id === activeProfileId
          ? {
              ...p,
              ig_account_id: active?.igAccountId ?? null,
              access_token: active?.accessToken ?? null,
            }
          : p,
      ),
    );
  };

  const handleDisconnectInstagramAccount = (igAccountId: string) => {
    if (!activeProfileId || !hasSupabase) {
      return;
    }
    setBusy(igAccountId);
    void (async () => {
      try {
        const result = await disconnectInstagramAccount(activeProfileId, igAccountId);
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        const nextAccounts = instagramAccounts.filter((account) => account.igAccountId !== igAccountId);
        setInstagramAccounts(nextAccounts);
        patchProfileAfterInstagramChange(nextAccounts);
        onConnectionsChanged();
      } finally {
        setBusy(null);
      }
    })();
  };

  const handleDisconnectAllInstagram = () => {
    if (!activeProfileId || !hasSupabase) {
      return;
    }
    setBusy("ig-all");
    void (async () => {
      try {
        const result = await disconnectInstagram(activeProfileId);
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        setInstagramAccounts([]);
        patchProfileAfterInstagramChange([]);
        onConnectionsChanged();
      } finally {
        setBusy(null);
      }
    })();
  };

  const handleDisconnectTikTok = () => {
    if (!activeProfileId || !hasSupabase) {
      return;
    }
    setBusy("tt");
    void (async () => {
      try {
        const result = await disconnectTikTok(activeProfileId);
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        onProfilesPatched((prev) =>
          prev.map((p) =>
            p.id === activeProfileId
              ? { ...p, tiktok_access_token: null, tiktok_refresh_token: null, tiktok_open_id: null }
              : p,
          ),
        );
        onConnectionsChanged();
      } finally {
        setBusy(null);
      }
    })();
  };

  const handleConnectInstagram = () => {
    if (!metaOAuthHref) {
      return;
    }
    openExternalUrl(metaOAuthHref);
  };

  const handleConnectTikTok = () => {
    if (!activeProfileId || typeof window === "undefined") {
      return;
    }
    const initUrl = `${window.location.origin}/api/auth/tiktok/init?profileId=${encodeURIComponent(activeProfileId)}`;
    openExternalUrl(initUrl);
  };

  return (
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-labelledby="social-connections-title"
        className="w-full max-w-md rounded-xl border border-white/15 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="social-connections-title" className="text-base font-semibold text-zinc-100">
          Manage connections
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Instagram and TikTok links for the selected profile ({activeProfileId ?? "—"}).
        </p>
        <p className="mt-2 rounded-md border border-zinc-700/80 bg-zinc-800/40 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-400">
          Sign-in opens in your default browser. When finished, return to this app — connections refresh
          automatically.
        </p>

        {!hasSupabase || !activeProfileId ? (
          <p className="mt-4 text-xs text-amber-200/90">
            Select a profile with cloud sync enabled to connect social accounts.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusDot connected={igConnected} />
                  <span className="text-sm font-medium text-zinc-100">Instagram</span>
                </div>
                <div className="flex items-center gap-2">
                  {igConnected ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={handleDisconnectAllInstagram}
                      className="rounded-md border border-red-500/45 px-2 py-1 text-[11px] font-semibold text-red-300/95 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {busy === "ig-all" ? "…" : "Disconnect all"}
                    </button>
                  ) : null}
                  {!process.env.NEXT_PUBLIC_META_CLIENT_ID?.trim() ? (
                    <span className="text-[10px] text-amber-200/80">Set META / env client id</span>
                  ) : metaOAuthHref ? (
                    <button
                      type="button"
                      onClick={handleConnectInstagram}
                      className="rounded-md border border-pink-500/50 bg-pink-500/15 px-2 py-1 text-[11px] font-semibold text-pink-100 hover:bg-pink-500/25"
                    >
                      {igConnected ? "Add account" : "Connect"}
                    </button>
                  ) : (
                    <span className="text-[10px] text-zinc-500">Preparing…</span>
                  )}
                </div>
              </div>

              {loadingInstagram ? (
                <p className="mt-3 text-[11px] text-zinc-500">Loading connected accounts…</p>
              ) : igConnected ? (
                <ul className="mt-3 space-y-2">
                  {instagramAccounts.map((account) => {
                    const busyThis = busy === account.igAccountId;
                    return (
                      <li
                        key={account.igAccountId}
                        className="flex items-center justify-between gap-2 rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2.5 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-zinc-100">
                            {instagramLabel(account)}
                          </p>
                          {account.pageName ? (
                            <p className="truncate text-[10px] text-zinc-500">{account.pageName}</p>
                          ) : null}
                          {account.isActive ? (
                            <p className="text-[10px] font-medium text-emerald-400/90">Active for publishing</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => handleDisconnectInstagramAccount(account.igAccountId)}
                          className="shrink-0 rounded-md border border-red-500/35 px-2 py-1 text-[10px] font-semibold text-red-300/90 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          {busyThis ? "…" : "Remove"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-[11px] text-zinc-500">No Instagram accounts connected yet.</p>
              )}
            </div>

            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusDot connected={ttConnected} />
                  <span className="text-sm font-medium text-zinc-100">TikTok</span>
                </div>
                {ttConnected ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={handleDisconnectTikTok}
                    className="rounded-md border border-red-500/45 px-2 py-1 text-[11px] font-semibold text-red-300/95 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {busy === "tt" ? "…" : "Disconnect"}
                  </button>
                ) : !process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY?.trim() ? (
                  <span className="text-[10px] text-amber-200/80">Set TikTok client key</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectTikTok}
                    className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/25"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg border border-zinc-600 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
        >
          Close
        </button>
      </div>
    </div>
  );
}
