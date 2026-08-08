import { jsPDF } from "jspdf";

import {
  parseFountainTokens,
  stripFountainNotesForPdf,
  type FountainToken,
} from "@/lib/fountainScreenplay";

/** US Letter in points (jsPDF default unit: pt when unit is 'pt') */
const PAGE_W = 612; // 8.5in
const PAGE_H = 792; // 11in
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const MARGIN_LEFT = 108; // 1.5in
const MARGIN_RIGHT = 72; // 1in
const LINE_H = 14; // ~12pt Courier single-spaced industry feel
const FONT_SIZE = 12;

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

type Block = {
  kind:
    | "scene"
    | "action"
    | "character"
    | "dialogue"
    | "parenthetical"
    | "transition"
    | "centered"
    | "title"
    | "blank";
  text: string;
};

function tokensToBlocks(tokens: FountainToken[]): Block[] {
  const blocks: Block[] = [];
  for (const token of tokens) {
    const type = token.type.toLowerCase();
    const text = stripHtml(token.text ?? "");
    if (!text && type !== "page_break") continue;

    if (type === "scene_heading" || type === "section") {
      blocks.push({ kind: "scene", text: text.toUpperCase() });
    } else if (type === "character") {
      blocks.push({ kind: "character", text: text.toUpperCase() });
    } else if (type === "dialogue") {
      blocks.push({ kind: "dialogue", text });
    } else if (type === "parenthetical") {
      blocks.push({ kind: "parenthetical", text });
    } else if (type === "transition") {
      blocks.push({ kind: "transition", text: text.toUpperCase() });
    } else if (type === "centered") {
      blocks.push({ kind: "centered", text });
    } else if (type === "title" || type === "credit" || type === "author" || type === "source") {
      blocks.push({ kind: "title", text });
    } else if (type === "page_break") {
      blocks.push({ kind: "blank", text: "" });
    } else {
      blocks.push({ kind: "action", text });
    }
  }
  return blocks;
}

function wrapLines(doc: jsPDF, text: string, maxWidth: number): string[] {
  if (!text) return [""];
  return doc.splitTextToSize(text, maxWidth) as string[];
}

/**
 * Compile Fountain source into an industry-style screenplay PDF and trigger download.
 */
export function exportScreenplayPdf(source: string, fileName = "screenplay.pdf"): void {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFont("courier", "normal");
  doc.setFontSize(FONT_SIZE);

  // Strictly strip Fountain / CRM `[[ ... ]]` notes before layout.
  const cleaned = stripFountainNotesForPdf(source);
  const tokens = parseFountainTokens(cleaned);
  const blocks = tokensToBlocks(tokens);

  const contentWidth = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT;
  let y = MARGIN_TOP;
  let page = 1;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN_BOTTOM) {
      doc.addPage();
      page += 1;
      y = MARGIN_TOP;
      // Page number (top right), skip page 1 title convention loosely
      if (page > 1) {
        doc.setFont("courier", "normal");
        doc.setFontSize(10);
        doc.text(String(page) + ".", PAGE_W - MARGIN_RIGHT, 48, { align: "right" });
        doc.setFontSize(FONT_SIZE);
      }
    }
  };

  const drawLines = (
    lines: string[],
    x: number,
    options?: { align?: "left" | "center" | "right"; bold?: boolean }
  ) => {
    if (options?.bold) {
      doc.setFont("courier", "bold");
    } else {
      doc.setFont("courier", "normal");
    }
    for (const line of lines) {
      ensureSpace(LINE_H);
      if (options?.align === "center") {
        doc.text(line, PAGE_W / 2, y, { align: "center" });
      } else if (options?.align === "right") {
        doc.text(line, PAGE_W - MARGIN_RIGHT, y, { align: "right" });
      } else {
        doc.text(line, x, y);
      }
      y += LINE_H;
    }
    doc.setFont("courier", "normal");
  };

  if (blocks.length === 0) {
    drawLines(["(Empty script)"], MARGIN_LEFT);
  }

  for (const block of blocks) {
    if (block.kind === "blank") {
      ensureSpace(LINE_H);
      y += LINE_H;
      continue;
    }

    if (block.kind === "scene") {
      y += LINE_H * 0.5;
      drawLines(wrapLines(doc, block.text, contentWidth), MARGIN_LEFT, { bold: true });
      y += LINE_H * 0.25;
      continue;
    }

    if (block.kind === "action" || block.kind === "title") {
      drawLines(wrapLines(doc, block.text, contentWidth), MARGIN_LEFT, {
        bold: block.kind === "title",
        align: block.kind === "title" ? "center" : "left",
      });
      y += LINE_H * 0.35;
      continue;
    }

    if (block.kind === "character") {
      y += LINE_H * 0.35;
      // Character cue ~2.2" from left margin area → ~158pt from left edge of page content start offset
      const charX = MARGIN_LEFT + 158;
      drawLines(wrapLines(doc, block.text, 180), charX);
      continue;
    }

    if (block.kind === "parenthetical") {
      const x = MARGIN_LEFT + 108;
      drawLines(wrapLines(doc, block.text, 200), x);
      continue;
    }

    if (block.kind === "dialogue") {
      const x = MARGIN_LEFT + 72;
      drawLines(wrapLines(doc, block.text, 252), x);
      y += LINE_H * 0.2;
      continue;
    }

    if (block.kind === "transition") {
      y += LINE_H * 0.35;
      drawLines(wrapLines(doc, block.text, contentWidth), MARGIN_LEFT, { align: "right" });
      y += LINE_H * 0.35;
      continue;
    }

    if (block.kind === "centered") {
      drawLines(wrapLines(doc, block.text, contentWidth), MARGIN_LEFT, { align: "center" });
      continue;
    }
  }

  const safeName = fileName.replace(/[^\w.\- ()]+/g, "_");
  doc.save(safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
}
