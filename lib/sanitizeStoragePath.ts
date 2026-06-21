/**
 * TypeScript re-export of the sanitizeStoragePath utility defined in
 * lib/sanitizeStoragePath.mjs.  This file exists solely so TypeScript
 * consumers that import "@/lib/sanitizeStoragePath" (without the .mjs
 * extension) get correct types without relying on skipLibCheck for the
 * plain-JS module.
 */

// Re-implement inline so we do not need cross-module .mjs import in TS.
const GERMAN_CHAR_MAP: Record<string, string> = {
  "\u00df": "ss",
  "\u1e9e": "SS",
  "\u00e4": "ae",
  "\u00c4": "Ae",
  "\u00f6": "oe",
  "\u00d6": "Oe",
  "\u00fc": "ue",
  "\u00dc": "Ue",
};

function normalizeSegment(segment: string): string {
  const germanNormalized = segment.replace(
    /[\u00df\u1e9e\u00e4\u00c4\u00f6\u00d6\u00fc\u00dc]/g,
    (ch) => GERMAN_CHAR_MAP[ch] ?? ch
  );
  return germanNormalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function sanitizeStoragePath(inputPath: unknown): string {
  const raw = String(inputPath ?? "").trim();
  if (!raw) {
    return "";
  }
  const normalizedPath = raw.replace(/\\/g, "/");
  const segments = normalizedPath
    .split("/")
    .filter(Boolean)
    .map((segment) => normalizeSegment(segment))
    .filter(Boolean);
  return segments.join("/");
}
