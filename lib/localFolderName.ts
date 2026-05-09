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

export function buildLocalFolderNameFromTask(row: {
  title: string | null;
  company_name: string | null;
  shoot_location: string | null;
  photoshoot_type?: string | null;
  street?: string | null;
  city?: string | null;
}): string {
  const titleParts = splitCalendarTitle(row.title);

  // Calendar sync format: [type of shoot] - [client] - [City]
  if (looksLikeCalendarSyncTitle(titleParts)) {
    const type = normalizeShootType(titleParts[0] ?? null);
    const client = titleParts[1] || row.company_name?.trim() || "Client";
    const city = titleParts[2] || row.city?.trim() || row.shoot_location?.trim() || "Unknown";
    return sanitizeWindowsFolderName(`${type} - ${client} - ${city}`);
  }

  // Manual booking format: [type of photoshoot] - [client/business name] - [street name and number, city]
  const type = normalizeShootType(row.photoshoot_type ?? titleParts[0] ?? null);
  const client =
    row.company_name?.trim() ||
    titleParts[1] ||
    titleParts[0] ||
    "Client";
  const street = row.street?.trim() ?? "";
  const city = row.city?.trim() ?? "";
  const addressPart =
    street && city
      ? `${street}, ${city}`
      : row.shoot_location?.trim() || city || "Unknown";

  return sanitizeWindowsFolderName(`${type} - ${client} - ${addressPart}`);
}
