"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  disconnectInstagram,
  disconnectInstagramAccount,
  disconnectLinkedIn,
  disconnectTikTok,
  getInstagramConnections,
  getLinkedInOrganizations,
  type InstagramConnectedAccount,
  type LinkedInOrganization,
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
  const [busy, setBusy] = useState<"ig-all" | "tt" | "li" | string | null>(null);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramConnectedAccount[]>([]);
  const [linkedinOrganizations, setLinkedinOrganizations] = useState<LinkedInOrganization[]>([]);
  const [loadingInstagram, setLoadingInstagram] = useState(false);
  const [platformConfig, setPlatformConfig] = useState<{ meta: boolean; tiktok: boolean; linkedin: boolean } | null>(
    null
  );
  const onConnectionsChangedRef = useRef(onConnectionsChanged);
  onConnectionsChangedRef.current = onConnectionsChanged;

  const loadInstagramAccounts = useCallback(async () => {
    if (!activeProfileId || !hasSupabase) {
      setInstagramAccounts([]);
      setLinkedinOrganizations([]);
      return;
    }
    setLoadingInstagram(true);
    try {
      const [result, organizations, configResponse] = await Promise.all([
        getInstagramConnections(activeProfileId),
        getLinkedInOrganizations(activeProfileId),
        fetch("/api/social/platform-config").then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as { meta: boolean; tiktok: boolean; linkedin: boolean };
        }),
      ]);
      setInstagramAccounts(result.ok ? result.accounts : []);
      setLinkedinOrganizations(organizations.ok ? organizations.organizations : []);
      if (configResponse) setPlatformConfig(configResponse);
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
  const liConnected =
    typeof activeProfile?.linkedin_access_token === "string" &&
    activeProfile.linkedin_access_token.trim().length > 0;
  const metaConfigured = platformConfig?.meta ?? Boolean(process.env.NEXT_PUBLIC_META_CLIENT_ID?.trim());
  const tiktokConfigured = platformConfig?.tiktok ?? Boolean(process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY?.trim());
  const linkedinConfigured = platformConfig?.linkedin ?? false;

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

  const handleDisconnectLinkedIn = () => {
    if (!activeProfileId || !hasSupabase) {
      return;
    }
    setBusy("li");
    void (async () => {
      try {
        const result = await disconnectLinkedIn(activeProfileId);
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        setLinkedinOrganizations([]);
        onProfilesPatched((prev) =>
          prev.map((profile) =>
            profile.id === activeProfileId
              ? {
                  ...profile,
                  linkedin_access_token: null,
                  linkedin_refresh_token: null,
                  linkedin_member_id: null,
                  linkedin_scope: null,
                }
              : profile,
          ),
        );
        onConnectionsChanged();
      } finally {
        setBusy(null);
      }
    })();
  };

  const handleConnectTikTok = () => {
    if (!activeProfileId || typeof window === "undefined") {
      return;
    }
    const initUrl = `${window.location.origin}/api/auth/tiktok/init?profileId=${encodeURIComponent(activeProfileId)}`;
    openExternalUrl(initUrl);
  };

  const handleConnectLinkedIn = () => {
    if (!activeProfileId || typeof window === "undefined") {
      return;
    }
    const initUrl = `${window.location.origin}/api/auth/linkedin/init?profileId=${encodeURIComponent(activeProfileId)}`;
    openExternalUrl(initUrl);
  };

  const handleConnectInstagramFallback = () => {
    if (!activeProfileId || typeof window === "undefined") return;
    openExternalUrl(`${window.location.origin}/api/auth/meta/init?profileId=${encodeURIComponent(activeProfileId)}`);
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
          Instagram, TikTok, and LinkedIn links for the selected profile ({activeProfileId ?? "—"}).
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
                  {!metaConfigured ? (
                    <span className="text-[10px] text-amber-200/80">Not configured yet. Set META_CLIENT_ID and META_CLIENT_SECRET.</span>
                  ) : metaOAuthHref ? (
                    <button
                      type="button"
                      onClick={handleConnectInstagram}
                      className="rounded-md border border-pink-500/50 bg-pink-500/15 px-2 py-1 text-[11px] font-semibold text-pink-100 hover:bg-pink-500/25"
                    >
                      {igConnected ? "Add account" : "Connect"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConnectInstagramFallback}
                      className="rounded-md border border-pink-500/50 bg-pink-500/15 px-2 py-1 text-[11px] font-semibold text-pink-100 hover:bg-pink-500/25"
                    >
                      {igConnected ? "Add account" : "Connect"}
                    </button>
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
                ) : !tiktokConfigured ? (
                  <span className="max-w-[14rem] text-right text-[10px] text-amber-200/80">
                    Not configured yet. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.
                  </span>
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

            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusDot connected={liConnected} />
                  <span className="text-sm font-medium text-zinc-100">LinkedIn</span>
                </div>
                {liConnected ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={handleDisconnectLinkedIn}
                    className="rounded-md border border-red-500/45 px-2 py-1 text-[11px] font-semibold text-red-300/95 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {busy === "li" ? "…" : "Disconnect"}
                  </button>
                ) : !linkedinConfigured ? (
                  <span className="max-w-[14rem] text-right text-[10px] text-amber-200/80">
                    Not configured yet. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectLinkedIn}
                    className="rounded-md border border-sky-500/50 bg-sky-500/15 px-2 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/25"
                  >
                    Connect
                  </button>
                )}
              </div>
              {liConnected && linkedinOrganizations.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {linkedinOrganizations.map((organization) => (
                    <li
                      key={organization.organizationId}
                      className="rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2.5 py-2"
                    >
                      <p className="truncate text-xs font-semibold text-zinc-100">
                        {organization.name || `Organization ${organization.organizationId}`}
                      </p>
                      {organization.vanityName ? (
                        <p className="truncate text-[10px] text-zinc-500">@{organization.vanityName.replace(/^@/, "")}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : liConnected ? (
                <p className="mt-3 text-[11px] text-zinc-500">
                  Connected. Organization pages appear here after LinkedIn finishes the company-page lookup.
                </p>
              ) : (
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                  Connects a LinkedIn member who administers a company page. Personal profile analytics are not available.
                </p>
              )}
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
