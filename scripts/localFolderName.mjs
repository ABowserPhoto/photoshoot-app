/** Mirrors lib/localFolderName.ts for the Node worker (no TS build step). */

const ILLEGAL_WIN_CHARS = /[<>:"/\\|?*]/g;

export function sanitizeWindowsFolderName(name) {
  const cleaned = name
    .replace(ILLEGAL_WIN_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
  return cleaned.length > 0 ? cleaned : "Photoshoot";
}

function formatCalendarDateForFolder(isoDate) {
  if (!isoDate || !String(isoDate).trim()) return "";
  const d = String(isoDate).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : sanitizeWindowsFolderName(String(isoDate).trim());
}

export function buildLocalFolderNameFromTask(row) {
  const titlePart = (String(row.title ?? "").trim() || String(row.company_name ?? "").trim() || "Photoshoot").trim();
  const addressPart = String(row.shoot_location ?? "").trim();
  const datePart = formatCalendarDateForFolder(row.photoshoot_date ?? null);

  let raw;
  if (addressPart && datePart) {
    raw = `${titlePart} - ${addressPart} - ${datePart}`;
  } else if (datePart) {
    raw = `${titlePart} - ${datePart}`;
  } else if (addressPart) {
    raw = `${titlePart} - ${addressPart}`;
  } else {
    raw = titlePart;
  }

  return sanitizeWindowsFolderName(raw);
}
