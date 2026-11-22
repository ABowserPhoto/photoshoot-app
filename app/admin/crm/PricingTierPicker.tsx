"use client";

import { BadgeEuro, Building2, History, type LucideIcon } from "lucide-react";

import { PRICING_TIERS, pricingTierLabel, type PricingTier } from "@/lib/pricingTiers";

const TIER_ICONS: Record<PricingTier, LucideIcon> = {
  standard: BadgeEuro,
  legacy: History,
  corporate: Building2,
};

type PricingTierPickerProps = {
  value: PricingTier | null;
  onChange: (tier: PricingTier) => void;
  disabled?: boolean;
  label?: string;
};

export default function PricingTierPicker({ value, onChange, disabled = false, label = "Pricing tier" }: PricingTierPickerProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {PRICING_TIERS.map((tier) => {
        const selected = value === tier;
        const Icon = TIER_ICONS[tier];
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(tier)}
            className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${
              selected
                ? "border-violet-500 bg-violet-600 text-white"
                : "border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-800"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{pricingTierLabel(tier)}</span>
          </button>
        );
      })}
    </div>
  );
}
