import { Fountain } from "fountain-js";

export type FountainHtml = {
  titlePage: string;
  script: string;
  title: string;
};

export type FountainToken = {
  type: string;
  text?: string;
  scene_number?: string;
};

const fountain = new Fountain();

/** Matches `[[note: <uuid>]]` CRM note anchors. */
export const CRM_NOTE_REF_RE = /\[\[\s*note:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\]\]/gi;

/** Any Fountain-style `[[ ... ]]` note block (stripped from PDF). */
export const FOUNTAIN_NOTE_BLOCK_RE = /\[\[([\s\S]*?)\]\]/g;

const CRM_NOTE_SENTINEL_PREFIX = "CRMNOTECHIP";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Strip every `[[ ... ]]` block (Fountain notes + CRM note refs) for PDF export. */
export function stripFountainNotesForPdf(source: string): string {
  return (source ?? "").replace(FOUNTAIN_NOTE_BLOCK_RE, "").replace(/[ \t]+\n/g, "\n");
}

/**
 * Protect CRM note refs before Fountain parse so they are not discarded as notes,
 * then restore them as clickable chips in the HTML preview.
 */
function protectCrmNoteRefs(source: string): { protectedSource: string; ids: string[] } {
  const ids: string[] = [];
  const protectedSource = (source ?? "").replace(CRM_NOTE_REF_RE, (_full, id: string) => {
    const index = ids.length;
    ids.push(id.toLowerCase());
    // Keep as visible plain text that survives Fountain action/dialogue parsing.
    return `${CRM_NOTE_SENTINEL_PREFIX}${index}Z`;
  });
  return { protectedSource, ids };
}

function injectCrmNoteChips(html: string, ids: string[]): string {
  let out = html;
  ids.forEach((id, index) => {
    const sentinel = `${CRM_NOTE_SENTINEL_PREFIX}${index}Z`;
    const chip = `<button type="button" class="crm-note-chip" data-note-id="${escapeHtml(id)}" title="Open CRM note">📝 View Note</button>`;
    out = out.split(sentinel).join(chip);
  });
  return out;
}

/** Parse Fountain source into HTML suitable for the preview pane (with CRM note chips). */
export function parseFountainToHtml(source: string): FountainHtml {
  const { protectedSource, ids } = protectCrmNoteRefs(source ?? "");
  try {
    const output = fountain.parse(protectedSource);
    return {
      title: output.title?.trim() || "Untitled Script",
      titlePage: injectCrmNoteChips(output.html?.title_page ?? "", ids),
      script: injectCrmNoteChips(output.html?.script ?? "", ids),
    };
  } catch (e) {
    console.warn("[fountain] parse failed:", e);
    return {
      title: "Untitled Script",
      titlePage: "",
      script: injectCrmNoteChips(`<p class="action">${escapeHtml(protectedSource)}</p>`, ids),
    };
  }
}

/** Parse Fountain tokens for PDF after stripping note blocks. */
export function parseFountainTokens(source: string): FountainToken[] {
  const text = stripFountainNotesForPdf(source ?? "");
  try {
    const output = fountain.parse(text, true);
    const tokens = (output.tokens ?? fountain.tokens ?? []) as FountainToken[];
    return tokens.filter((t) => t && typeof t.type === "string");
  } catch (e) {
    console.warn("[fountain] token parse failed:", e);
    return [{ type: "action", text }];
  }
}

export function formatCrmNoteAnchor(noteId: string): string {
  return `[[note: ${noteId.trim()}]]`;
}

/** Industry-ish screenplay CSS for the live preview (US Letter proportions). */
export const SCREENPLAY_PREVIEW_CSS = `
  .screenplay-page {
    background: #fff;
    color: #111;
    font-family: "Courier Prime", "Courier New", Courier, monospace;
    font-size: 12pt;
    line-height: 1.15;
    width: 8.5in;
    min-height: 11in;
    padding: 1in 1in 1in 1.5in;
    box-sizing: border-box;
    box-shadow: 0 8px 30px rgba(0,0,0,0.35);
  }
  .screenplay-page .title-page {
    margin-bottom: 2.5rem;
    text-align: center;
  }
  .screenplay-page .title-page h1 {
    font-size: 12pt;
    font-weight: bold;
    text-transform: uppercase;
    margin: 3rem 0 1rem;
  }
  .screenplay-page h2,
  .screenplay-page h3 {
    font-size: 12pt;
    font-weight: bold;
    margin: 1.2em 0 0.8em;
    text-transform: uppercase;
  }
  .screenplay-page p {
    margin: 0 0 0.85em;
    white-space: pre-wrap;
  }
  .screenplay-page .scene-heading,
  .screenplay-page h3 {
    text-transform: uppercase;
    font-weight: bold;
    margin-top: 1.4em;
  }
  .screenplay-page .action {
    margin: 0.9em 0;
  }
  .screenplay-page .character {
    margin: 1em 0 0;
    padding-left: 2.2in;
    text-transform: uppercase;
    width: 100%;
    box-sizing: border-box;
  }
  .screenplay-page .dialogue {
    margin: 0 0 0.2em;
    padding-left: 1in;
    padding-right: 1.25in;
    width: 100%;
    box-sizing: border-box;
  }
  .screenplay-page .parenthetical {
    margin: 0;
    padding-left: 1.6in;
    padding-right: 1.8in;
  }
  .screenplay-page .transition {
    text-align: right;
    text-transform: uppercase;
    margin: 1em 0;
  }
  .screenplay-page .centered {
    text-align: center;
  }
  .screenplay-page .crm-note-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin: 0 0.15rem;
    padding: 0.1rem 0.45rem;
    border: 1px solid #7c3aed;
    border-radius: 999px;
    background: #ede9fe;
    color: #5b21b6;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.4;
    cursor: pointer;
    vertical-align: middle;
  }
  .screenplay-page .crm-note-chip:hover {
    background: #ddd6fe;
  }
`;
