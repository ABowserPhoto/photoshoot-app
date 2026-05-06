/** Windows illegal filename characters: < > : " / \ | ? * */
const ILLEGAL_WIN_CHARS = /[<>:"/\\|?*]/g;

export function sanitizeWindowsFolderName(name: string): string {
  const cleaned = name
    .replace(ILLEGAL_WIN_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
  return cleaned.length > 0 ? cleaned : "Photoshoot";
}

function formatCalendarDateForFolder(isoDate: string | null): string {
  if (!isoDate || !isoDate.trim()) return "";
  const d = isoDate.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : sanitizeWindowsFolderName(isoDate.trim());
}

/**
 * Folder label from calendar-aligned fields on the task:
 * event title → `title`, location → `shoot_location`, event day → `photoshoot_date`.
 */
export function buildLocalFolderNameFromTask(row: {
  title: string | null;
  company_name: string | null;
  shoot_location: string | null;
  photoshoot_date: string | null;
}): string {
  const titlePart = (row.title?.trim() || row.company_name?.trim() || "Photoshoot").trim();
  const addressPart = row.shoot_location?.trim() || "";
  const datePart = formatCalendarDateForFolder(row.photoshoot_date);

  let raw: string;
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
