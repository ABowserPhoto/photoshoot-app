export const PRICING_TIERS = ["standard", "legacy", "corporate"] as const;

export type PricingTier = (typeof PRICING_TIERS)[number];

export const PRICING_ITEM_KEYS = [
  "photo_package_10",
  "photo_package_15",
  "photo_package_25",
  "photo_package_30",
  "photo_package_40",
  "photo_package_50",
  "individual_photo",
  "booking_fee",
  "drone_photos",
  "drone_video",
  "highlight_video",
  "walk_thru_video",
  "agent_branding_video",
  "premium_home_package",
  "luxury_makler_package",
  "tour_360",
  "homestaging",
] as const;

export type PricingItemKey = (typeof PRICING_ITEM_KEYS)[number];

export const PRICING_UNITS = ["flat", "per_photo"] as const;

export type PricingUnit = (typeof PRICING_UNITS)[number];

export type PricingPriceRecord = {
  id: string;
  tier: PricingTier;
  itemKey: string;
  labelDe: string;
  labelEn: string;
  unit: PricingUnit;
  priceNetCents: number | null;
  sortOrder: number;
  active: boolean;
  updatedAt: string;
};

/** Standard net prices in euro cents. Other Standard items and other tiers stay unset. */
export const STANDARD_SEED_PRICE_NET_CENTS: Partial<Record<PricingItemKey, number>> = {
  photo_package_10: 12900,
  photo_package_15: 18900,
  photo_package_25: 22900,
  booking_fee: 1900,
  drone_photos: 4900,
  drone_video: 19000,
  highlight_video: 29000,
  homestaging: 3500,
};

const PER_PHOTO_ITEM_KEYS = new Set<PricingItemKey>(["individual_photo", "homestaging"]);

const MAX_PRICE_NET_CENTS = 100_000_000;

export function isPricingTier(value: unknown): value is PricingTier {
  return typeof value === "string" && (PRICING_TIERS as readonly string[]).includes(value);
}

export function parsePricingTier(value: unknown): PricingTier | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return (PRICING_TIERS as readonly string[]).includes(normalized) ? (normalized as PricingTier) : null;
}

export type PricingTierField =
  | { status: "absent" }
  | { status: "null" }
  | { status: "tier"; tier: PricingTier }
  | { status: "invalid" };

export function readPricingTierField(body: object, key = "pricing_tier"): PricingTierField {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return { status: "absent" };
  }
  const value = (body as Record<string, unknown>)[key];
  if (value === null || value === "") {
    return { status: "null" };
  }
  const tier = parsePricingTier(value);
  if (!tier) {
    return { status: "invalid" };
  }
  return { status: "tier", tier };
}

export function pricingTierLabel(tier: PricingTier): string {
  switch (tier) {
    case "standard":
      return "Standard";
    case "legacy":
      return "Legacy";
    case "corporate":
      return "Corporate";
    default: {
      const exhaustive: never = tier;
      return exhaustive;
    }
  }
}

export function pricingUnitLabel(unit: PricingUnit): string {
  switch (unit) {
    case "flat":
      return "Flat";
    case "per_photo":
      return "Per photo";
    default: {
      const exhaustive: never = unit;
      return exhaustive;
    }
  }
}

export function pricingItemUnit(itemKey: PricingItemKey): PricingUnit {
  return PER_PHOTO_ITEM_KEYS.has(itemKey) ? "per_photo" : "flat";
}

export function isPricingUnit(value: unknown): value is PricingUnit {
  return value === "flat" || value === "per_photo";
}

/**
 * An absent field keeps the stored tier. An explicit null clears it.
 * `requiresTier` is set when an existing pending client is being approved.
 * New staff-created clients may stay NULL until a tier is assigned.
 */
export function resolveClientPricingTier(input: {
  requiresTier: boolean;
  field: PricingTierField;
  existing: PricingTier | null;
}): { ok: true; tier: PricingTier | null } | { ok: false; error: string } {
  if (input.field.status === "invalid") {
    return { ok: false, error: "pricing_tier must be standard, legacy, or corporate." };
  }

  const requested =
    input.field.status === "tier" ? input.field.tier : input.field.status === "null" ? null : input.existing;

  if (input.requiresTier && !requested) {
    return { ok: false, error: "Choose a pricing tier before approving this client." };
  }

  return { ok: true, tier: requested };
}

export function parseEuroInputToCents(
  input: string
): { ok: true; cents: number | null } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed || /^(auf anfrage|preis auf anfrage)$/i.test(trimmed)) {
    return { ok: true, cents: null };
  }

  const normalized = trimmed.replace(/€/g, "").replace(/\s/g, "");
  if (!/^\d+([.,]\d{1,2})?$/.test(normalized)) {
    return { ok: false, error: "Enter a net price in euros, or leave it empty for auf Anfrage." };
  }

  const [whole, fraction = ""] = normalized.split(/[.,]/);
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_PRICE_NET_CENTS) {
    return { ok: false, error: "Price is too large." };
  }
  return { ok: true, cents };
}

export function formatCentsForInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) {
    return "";
  }
  const whole = Math.trunc(cents / 100);
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function parsePriceNetCents(value: unknown): { ok: true; cents: number | null } | { ok: false; error: string } {
  if (value === null || value === "") {
    return { ok: true, cents: null };
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > MAX_PRICE_NET_CENTS) {
      return { ok: false, error: "price_net_cents must be a non-negative integer number of cents, or null." };
    }
    return { ok: true, cents: value };
  }
  if (typeof value === "string") {
    return parseEuroInputToCents(value);
  }
  return { ok: false, error: "price_net_cents must be a non-negative integer number of cents, or null." };
}

const MAX_LABEL_LENGTH = 160;

export function parsePricingLabel(value: unknown): { ok: true; label: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, label: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "Labels must be text." };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, label: null };
  }
  if (trimmed.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: `Labels must be ${MAX_LABEL_LENGTH} characters or fewer.` };
  }
  return { ok: true, label: trimmed };
}
