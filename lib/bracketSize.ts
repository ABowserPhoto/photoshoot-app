/** Supported HDR bracket sizes for Immobilien shoots. */
export const IMMOBILIEN_BRACKET_SIZES = [3, 5, 7] as const;

export type BracketSize = (typeof IMMOBILIEN_BRACKET_SIZES)[number];

export function isImmobilienPhotoshootType(value: string | null | undefined): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "immobilien" || normalized === "real estate";
}

export function normalizeBracketSize(value: unknown, fallback: BracketSize = 5): BracketSize {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (parsed === 3 || parsed === 5 || parsed === 7) {
    return parsed;
  }
  return fallback;
}

export function parseBracketSizeForDb(
  value: unknown,
  options?: { photoshootType?: string | null; fallback?: BracketSize }
): number | null {
  const fallback = options?.fallback ?? 5;
  if (value === null || value === undefined || value === "") {
    return options?.photoshootType && isImmobilienPhotoshootType(options.photoshootType) ? fallback : null;
  }
  return normalizeBracketSize(value, fallback);
}
