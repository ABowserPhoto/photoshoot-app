"use client";

import { useState } from "react";

import {
  disconnectInstagram,
  disconnectTikTok,
  type MetaIgAccountOption,
} from "@/app/actions/social-profiles";
import InstagramAccountSelector from "@/app/components/InstagramAccountSelector";
import type { SchedulerSocialProfileRow } from "@/lib/schedulerSocialProfile";

type SocialConnectionsModalProps = {
  open: boolean;
  onClose: () => void;
  activeProfileId: string | null;
  activeProfile: SchedulerSocialProfileRow | null;
  hasSupabase: boolean;
  metaOAuthHref: string | null;
  igSelector: { profileId: string; accounts: MetaIgAccountOption[] } | null;
  onIgSelectorClose: () => void;
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

export default function SocialConnectionsModal({
  open,
  onClose,
  activeProfileId,
  activeProfile,
  hasSupabase,
  metaOAuthHref,
  igSelector,
  onIgSelectorClose,
  onConnectionsChanged,
  onProfilesPatched,
}: SocialConnectionsModalProps) {
  const [busy, setBusy] = useState<"ig" | "tt" | null>(null);

  if (!open) {
    return null;
  }

  const igConnected =
    typeof activeProfile?.ig_account_id === "string" && activeProfile.ig_account_id.trim().length > 0;
  const ttConnected =
    typeof activeProfile?.tiktok_access_token === "string" &&
    activeProfile.tiktok_access_token.trim().length > 0;

  const handleDisconnectInstagram = () => {
    if (!activeProfileId || !hasSupabase) {
      return;
    }
    setBusy("ig");
    void (async () => {
      try {
        const result = await disconnectInstagram(activeProfileId);
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        onProfilesPatched((prev) =>
          prev.map((p) =>
            p.id === activeProfileId ? { ...p, ig_account_id: null, access_token: null } : p,
          ),
        );
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

  return (
    <>
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
                  {igConnected ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={handleDisconnectInstagram}
                      className="rounded-md border border-red-500/45 px-2 py-1 text-[11px] font-semibold text-red-300/95 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {busy === "ig" ? "…" : "Disconnect"}
                    </button>
                  ) : !process.env.NEXT_PUBLIC_META_CLIENT_ID?.trim() ? (
                    <span className="text-[10px] text-amber-200/80">Set META / env client id</span>
                  ) : metaOAuthHref ? (
                    <a
                      href={metaOAuthHref}
                      className="rounded-md border border-pink-500/50 bg-pink-500/15 px-2 py-1 text-[11px] font-semibold text-pink-100 hover:bg-pink-500/25"
                    >
                      Connect
                    </a>
                  ) : (
                    <span className="text-[10px] text-zinc-500">Preparing…</span>
                  )}
                </div>
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
                    <a
                      href={`/api/auth/tiktok/init?profileId=${encodeURIComponent(activeProfileId)}`}
                      className="rounded-md border border-cyan-500/50 bg-cyan-500/15 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/25"
                    >
                      Connect
                    </a>
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

      {igSelector ? (
        <InstagramAccountSelector
          profileId={igSelector.profileId}
          accounts={igSelector.accounts}
          onClose={onIgSelectorClose}
          onSaved={() => {
            onConnectionsChanged();
            window.alert("Instagram connected successfully.");
          }}
        />
      ) : null}
    </>
  );
}
