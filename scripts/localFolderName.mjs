/** Mirrors lib/localFolderName.ts for the Node worker (no TS build step). */

const GERMAN_CHAR_MAP = {
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

export function sanitizeWindowsFolderName(name) {
  const germanNormalized = String(name ?? "").replace(/[ßẞäÄöÖüÜ]/g, (ch) => GERMAN_CHAR_MAP[ch] ?? ch);
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

function normalizeShootType(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Photoshoot";
  return raw.toLowerCase() === "real estate" ? "Immobilien" : raw;
}

function splitCalendarTitle(title) {
  return String(title ?? "")
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikeCalendarSyncTitle(parts) {
  if (parts.length < 3) return false;
  const first = String(parts[0] ?? "").toLowerCase();
  return first === "real estate" || first === "immobilien" || first === "business portraits";
}

export function buildLocalFolderNameFromTask(row) {
  const titleParts = splitCalendarTitle(row.title);

  if (looksLikeCalendarSyncTitle(titleParts)) {
    const type = normalizeShootType(titleParts[0] ?? null);
    const client = titleParts[1] || String(row.company_name ?? "").trim() || "Client";
    const city = titleParts[2] || String(row.city ?? "").trim() || String(row.shoot_location ?? "").trim() || "Unknown";
    return sanitizeWindowsFolderName(`${type} - ${client} - ${city}`);
  }

  const type = normalizeShootType(row.photoshoot_type ?? titleParts[0] ?? null);
  const client =
    String(row.company_name ?? "").trim() ||
    titleParts[1] ||
    titleParts[0] ||
    "Client";
  const street = String(row.street ?? "").trim();
  const city = String(row.city ?? "").trim();
  const addressPart =
    street && city
      ? `${street}, ${city}`
      : String(row.shoot_location ?? "").trim() || city || "Unknown";

  return sanitizeWindowsFolderName(`${type} - ${client} - ${addressPart}`);
}
