"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import PricingTierPicker from "@/app/admin/crm/PricingTierPicker";
import {
  formatCentsForInput,
  parseEuroInputToCents,
  pricingUnitLabel,
  type PricingPriceRecord,
  type PricingTier,
} from "@/lib/pricingTiers";

type PricingEditorSectionProps = {
  active: boolean;
  onToast: (message: string) => void;
  onError: (message: string | null) => void;
};

type EditorRow = {
  id: string;
  tier: PricingTier;
  itemKey: string;
  labelDe: string;
  labelEn: string;
  unit: PricingPriceRecord["unit"];
  priceInput: string;
  active: boolean;
  sortOrder: number;
};

function toEditorRow(row: PricingPriceRecord): EditorRow {
  return {
    id: row.id,
    tier: row.tier,
    itemKey: row.itemKey,
    labelDe: row.labelDe,
    labelEn: row.labelEn,
    unit: row.unit,
    priceInput: formatCentsForInput(row.priceNetCents),
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

export default function PricingEditorSection({ active, onToast, onError }: PricingEditorSectionProps) {
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [tier, setTier] = useState<PricingTier>("standard");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});

  const loadPrices = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/pricing", { cache: "no-store", credentials: "include" });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; prices?: PricingPriceRecord[]; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(json?.error ?? `Failed to load prices (${response.status})`);
      }
      setRows((json?.prices ?? []).map(toEditorRow));
      setPriceErrors({});
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load prices.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) {
        await loadPrices();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, loadPrices]);

  const visibleRows = useMemo(
    () =>
      rows
        .filter((row) => row.tier === tier)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.itemKey.localeCompare(b.itemKey)),
    [rows, tier]
  );

  const updateRow = (id: string, patch: Partial<EditorRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    if (patch.priceInput !== undefined) {
      setPriceErrors((prev) => {
        if (!prev[id]) {
          return prev;
        }
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleSave = async () => {
    const errors: Record<string, string> = {};
    const prices = rows.map((row) => {
      const parsed = parseEuroInputToCents(row.priceInput);
      if (!parsed.ok) {
        errors[row.id] = parsed.error;
      }
      return {
        id: row.id,
        label_de: row.labelDe,
        label_en: row.labelEn,
        price_net_cents: parsed.ok ? parsed.cents : null,
        active: row.active,
      };
    });

    if (Object.keys(errors).length > 0) {
      setPriceErrors(errors);
      const firstTier = rows.find((row) => errors[row.id])?.tier;
      if (firstTier) {
        setTier(firstTier);
      }
      onError("Fix the highlighted prices before saving.");
      return;
    }

    setSaving(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/crm/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prices }),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; prices?: PricingPriceRecord[]; error?: string }
        | null;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error ?? `Save failed (${response.status})`);
      }
      setRows((json.prices ?? []).map(toEditorRow));
      setPriceErrors({});
      onToast("Prices saved.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save prices.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Preise / Pricing</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Net prices excluding VAT for each client tier. An empty price means Preis auf Anfrage. Approved
            clients only see the active prices for their own tier.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadPrices()}
            disabled={loading || saving}
            className="inline-flex h-10 items-center rounded-lg border border-zinc-700 bg-zinc-950 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading || saving || rows.length === 0}
            className="inline-flex h-10 items-center rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save prices"}
          </button>
        </div>
      </div>

      <PricingTierPicker value={tier} onChange={setTier} disabled={saving} label="Price list tier" />

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-950/70">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Item
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Label DE
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Label EN
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Unit
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Net EUR
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Active
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  Loading prices…
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No price rows for this tier.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-950/40">
                  <td className="px-4 py-3 align-top">
                    <div className="font-mono text-xs text-zinc-200">{row.itemKey}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <input
                      value={row.labelDe}
                      onChange={(event) => updateRow(row.id, { labelDe: event.target.value })}
                      disabled={saving}
                      aria-label={`${row.itemKey} German label`}
                      className="h-10 w-full min-w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <input
                      value={row.labelEn}
                      onChange={(event) => updateRow(row.id, { labelEn: event.target.value })}
                      disabled={saving}
                      aria-label={`${row.itemKey} English label`}
                      className="h-10 w-full min-w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-3 align-top text-zinc-300">{pricingUnitLabel(row.unit)}</td>
                  <td className="px-4 py-3 align-top">
                    <input
                      inputMode="decimal"
                      value={row.priceInput}
                      onChange={(event) => updateRow(row.id, { priceInput: event.target.value })}
                      disabled={saving}
                      placeholder="auf Anfrage"
                      aria-label={`${row.itemKey} net price in euros`}
                      aria-invalid={Boolean(priceErrors[row.id])}
                      className={`h-10 w-full min-w-36 rounded-lg border bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-500 disabled:opacity-50 ${
                        priceErrors[row.id] ? "border-red-500" : "border-zinc-700"
                      }`}
                    />
                    {priceErrors[row.id] ? (
                      <p className="mt-1 text-xs text-red-300">{priceErrors[row.id]}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.active}
                      aria-label={`${row.itemKey} active`}
                      disabled={saving}
                      onClick={() => updateRow(row.id, { active: !row.active })}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                        row.active ? "bg-violet-600" : "bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                          row.active ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
