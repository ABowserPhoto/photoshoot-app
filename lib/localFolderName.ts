const GERMAN_CHAR_MAP: Record<string, string> = {
  ß: "ss",
  ẞ: "SS",
  ä: "ae",
  Ä: "Ae",
  ö: "oe",
  Ö: "Oe",
  ü: "ue",
  Ü: "Ue",
};
const ILLEGAL_WIN_CHARS = /[<>:"/\\|?*]/g;

export function sanitizeWindowsFolderName(name: string): string {
  const germanNormalized = name.replace(/[ßẞäÄöÖüÜ]/g, (ch) => GERMAN_CHAR_MAP[ch] ?? ch);
  const cleaned = germanNormalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(ILLEGAL_WIN_CHARS, "_")
    .replace(/[^\w\s.,&\-()+]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
  return cleaned.length > 0 ? cleaned : "Photoshoot";
}

function normalizeShootType(value: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "Photoshoot";
  return raw.toLowerCase() === "real estate" ? "Immobilien" : raw;
}

function splitCalendarTitle(title: string | null): string[] {
  return (title ?? "")
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikeCalendarSyncTitle(parts: string[]): boolean {
  if (parts.length < 3) return false;
  const first = parts[0]?.toLowerCase() ?? "";
  return first === "real estate" || first === "immobilien" || first === "business portraits";
}

function formatClientAddress(street?: string | null, city?: string | null): string {
  const streetPart = street?.trim() ?? "";
  const cityPart = city?.trim() ?? "";
  if (streetPart && cityPart) {
    return `${streetPart}, ${cityPart}`;
  }
  return streetPart || cityPart;
}

/** Join only non-empty parts so folder names never end with a dangling " - ". */
function joinFolderParts(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" - ");
}

/**
 * Prefer photoshoot location (`shoot_location`); fall back to client address.
 * Omits the trailing segment entirely when both are blank.
 */
function resolveLocationPart(row: {
  shoot_location?: string | null;
  street?: string | null;
  city?: string | null;
  titleLocationFallback?: string | null;
}): string {
  return (
    row.shoot_location?.trim() ||
    row.titleLocationFallback?.trim() ||
    formatClientAddress(row.street, row.city)
  );
}

export function buildLocalFolderNameFromTask(row: {
  title: string | null;
  company_name: string | null;
  shoot_location: string | null;
  photoshoot_type?: string | null;
  street?: string | null;
  city?: string | null;
}): string {
  const titleParts = splitCalendarTitle(row.title);

  // Calendar sync format: [type of shoot] - [client] - [location]
  if (looksLikeCalendarSyncTitle(titleParts)) {
    const type = normalizeShootType(titleParts[0] ?? null);
    const client = titleParts[1] || row.company_name?.trim() || "Client";
    const location = resolveLocationPart({
      shoot_location: row.shoot_location,
      street: row.street,
      city: row.city,
      titleLocationFallback: titleParts[2] ?? null,
    });
    return sanitizeWindowsFolderName(joinFolderParts(type, client, location));
  }

  // Manual booking format: [type of photoshoot] - [client] - [photoshoot location]
  // Falls back to client address when shoot location is blank.
  const type = normalizeShootType(row.photoshoot_type ?? titleParts[0] ?? null);
  const client =
    row.company_name?.trim() ||
    titleParts[1] ||
    titleParts[0] ||
    "Client";
  const location = resolveLocationPart({
    shoot_location: row.shoot_location,
    street: row.street,
    city: row.city,
  });

  return sanitizeWindowsFolderName(joinFolderParts(type, client, location));
}
