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

function formatClientAddress(street, city) {
  const streetPart = String(street ?? "").trim();
  const cityPart = String(city ?? "").trim();
  if (streetPart && cityPart) {
    return `${streetPart}, ${cityPart}`;
  }
  return streetPart || cityPart;
}

/** Join only non-empty parts so folder names never end with a dangling " - ". */
function joinFolderParts(...parts) {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" - ");
}

/**
 * Prefer photoshoot location (`shoot_location`); fall back to client address.
 * Omits the trailing segment entirely when both are blank.
 */
function resolveLocationPart(row) {
  return (
    String(row.shoot_location ?? "").trim() ||
    String(row.titleLocationFallback ?? "").trim() ||
    formatClientAddress(row.street, row.city)
  );
}

export function buildLocalFolderNameFromTask(row) {
  const titleParts = splitCalendarTitle(row.title);

  if (looksLikeCalendarSyncTitle(titleParts)) {
    const type = normalizeShootType(titleParts[0] ?? null);
    const client = titleParts[1] || String(row.company_name ?? "").trim() || "Client";
    const location = resolveLocationPart({
      shoot_location: row.shoot_location,
      street: row.street,
      city: row.city,
      titleLocationFallback: titleParts[2] ?? null,
    });
    return sanitizeWindowsFolderName(joinFolderParts(type, client, location));
  }

  const type = normalizeShootType(row.photoshoot_type ?? titleParts[0] ?? null);
  const client =
    String(row.company_name ?? "").trim() ||
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
