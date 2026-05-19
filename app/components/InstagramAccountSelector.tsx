"use client";

import { useState } from "react";

import {
  type MetaIgAccountOption,
  saveInstagramConnection,
} from "@/app/actions/social-profiles";

type InstagramAccountSelectorProps = {
  profileId: string;
  accounts: MetaIgAccountOption[];
  onClose: () => void;
  onSaved: () => void;
};

export default function InstagramAccountSelector({
  profileId,
  accounts,
  onClose,
  onSaved,
}: InstagramAccountSelectorProps) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectAccount = async (option: MetaIgAccountOption) => {
    setError(null);
    setSavingId(option.igAccountId);
    try {
      const result = await saveInstagramConnection(
        profileId,
        option.igAccountId,
        option.pageAccessToken
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        className="max-h-[90vh] w-full max-w-md overflow-hidden rounded-xl border border-white/15 bg-zinc-900 shadow-2xl"
        role="dialog"
        aria-labelledby="ig-selector-title"
      >
        <div className="border-b border-white/10 px-4 py-3">
          <h2 id="ig-selector-title" className="text-sm font-semibold text-zinc-100">
            Choose Instagram account
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            Select the Facebook Page / Instagram profile to connect to this scheduler profile.
          </p>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto p-2">
          {accounts.map((acc) => {
            const busy = savingId === acc.igAccountId;
            const igLabel = acc.igUsername ? `@${acc.igUsername.replace(/^@/, "")}` : "Instagram";
            return (
              <li key={acc.igAccountId} className="mb-2">
                <button
                  type="button"
                  disabled={savingId !== null}
                  onClick={() => void selectAccount(acc)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-3 text-left text-sm text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:opacity-50"
                >
                  <span className="block font-semibold">{acc.pageName || "Facebook Page"}</span>
                  <span className="mt-0.5 block text-xs text-zinc-400">{igLabel}</span>
                  {busy ? <span className="mt-1 block text-[10px] text-pink-300">Saving…</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {error ? <p className="px-4 pb-2 text-xs text-red-400">{error}</p> : null}
        <div className="border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={savingId !== null}
            className="w-full rounded-lg border border-zinc-600 bg-transparent py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
