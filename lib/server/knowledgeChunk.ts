export const KNOWLEDGE_CHUNK_MIN_CHARS = 1_000;
export const KNOWLEDGE_CHUNK_MAX_CHARS = 1_500;
export const KNOWLEDGE_CHUNK_TITLE_MAX_CHARS = 200;

function lastBreakInRange(text: string, minChars: number, maxChars: number, needle: string): number {
  const window = text.slice(0, maxChars);
  const index = window.lastIndexOf(needle);
  return index >= minChars ? index : -1;
}

function lastRegexBreakInRange(text: string, minChars: number, maxChars: number, pattern: RegExp): number {
  const window = text.slice(0, maxChars);
  let best = -1;
  for (const match of window.matchAll(pattern)) {
    const index = match.index ?? -1;
    if (index >= minChars) {
      best = index + match[0].length;
    }
  }
  return best;
}

function nextWhitespaceIndex(text: string, from: number): number {
  const match = text.slice(from).match(/\s/);
  if (!match || match.index === undefined) return -1;
  return from + match.index;
}

/**
 * Split extracted PDF/SOP text into ~1,000–1,500 character chunks without cutting words.
 */
export function chunkKnowledgeText(
  text: string,
  options?: { minChars?: number; maxChars?: number }
): string[] {
  const minChars = options?.minChars ?? KNOWLEDGE_CHUNK_MIN_CHARS;
  const maxChars = options?.maxChars ?? KNOWLEDGE_CHUNK_MAX_CHARS;
  if (minChars < 1 || maxChars < minChars) {
    throw new Error("Invalid chunk size: maxChars must be >= minChars >= 1.");
  }

  const normalized = text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!normalized) return [];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    let breakAt = lastBreakInRange(remaining, minChars, maxChars, "\n\n");
    if (breakAt < 0) breakAt = lastBreakInRange(remaining, minChars, maxChars, "\n");
    if (breakAt < 0) {
      breakAt = lastRegexBreakInRange(remaining, minChars, maxChars, /[.!?;:]\s+/g);
    }
    if (breakAt < 0) breakAt = lastBreakInRange(remaining, minChars, maxChars, " ");

    if (breakAt < 0) {
      const lastSpaceInWindow = remaining.lastIndexOf(" ", maxChars - 1);
      if (lastSpaceInWindow > 0) {
        breakAt = lastSpaceInWindow;
      } else {
        const extended = nextWhitespaceIndex(remaining, maxChars);
        breakAt = extended > 0 ? extended : remaining.length;
      }
    }

    const chunk = remaining.slice(0, breakAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(breakAt).trim();
  }

  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1]!;
    const prev = chunks[chunks.length - 2]!;
    if (last.length < minChars / 2 && prev.length + 2 + last.length <= maxChars) {
      chunks[chunks.length - 2] = `${prev}\n\n${last}`;
      chunks.pop();
    }
  }

  return chunks.filter(Boolean);
}

export function sanitizeUploadedFilename(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop()?.trim() || "document.pdf";
  return base.replace(/[<>:"|?*\u0000]/g, "_") || "document.pdf";
}

/** Titles like `Studio Manual.pdf - Part 3`, truncated to the documents.title limit. */
export function knowledgePdfChunkTitle(
  originalFilename: string,
  partIndex: number,
  maxChars = KNOWLEDGE_CHUNK_TITLE_MAX_CHARS
): string {
  const suffix = ` - Part ${partIndex}`;
  const name = sanitizeUploadedFilename(originalFilename);
  const budget = Math.max(1, maxChars - suffix.length);
  const truncated = name.length > budget ? `${name.slice(0, Math.max(1, budget - 1))}…` : name;
  return `${truncated}${suffix}`;
}
