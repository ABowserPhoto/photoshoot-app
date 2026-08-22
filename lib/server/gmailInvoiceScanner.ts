import type { gmail_v1 } from "googleapis";

import { getGmailReadonlyClient } from "@/lib/google";
import { uploadLexofficeVoucherFile } from "@/lib/lexoffice";
import {
  applyLexofficeProcessedLabel,
  ensureLexofficeProcessedLabel,
  LEXOFFICE_PROCESSED_LABEL,
  messageHasProcessedLabel,
} from "@/lib/server/gmailProcessedLabel";
import { htmlEmailToPdfBuffer } from "@/lib/server/htmlToPdf";
import {
  getScannedGmailMessageIds,
  recordScannedInvoice,
} from "@/lib/server/scannedInvoicesStore";

const GMAIL_USER = "me";
const MAX_MESSAGES = 40;

export const DEFAULT_INVOICE_SCAN_TIMEFRAME = "7d";
const ALLOWED_INVOICE_SCAN_TIMEFRAMES = new Set(["7d", "1m", "3m", "6m"]);

const INVOICE_STRUCTURAL_PHRASES =
  /Rechnungsnummer|Invoice Number|Bestellnummer|Order Number|Rechnungsbetrag|Total Due|Receipt Number|Transaktionsnummer/i;

const SUBJECT_INVOICE_PATTERN = /\b(invoice|rechnung|receipt|quittung)\b/i;

const INVOICE_LINK_CONTEXT =
  /download invoice|rechnung herunterladen|view receipt|beleg ansehen/i;

const IMAGE_ATTACHMENT_PATTERN = /\.(jpe?g|png|gif|webp)$/i;

export type InvoiceScannerUploadResult = {
  messageId: string;
  subject: string;
  source: "attachment" | "html" | "link";
  fileName: string;
  ok: boolean;
  lexofficeFileId?: string | null;
  lexofficeVoucherId?: string | null;
  error?: string;
};

export type InvoiceScannerRunResult = {
  scannedMessages: number;
  skippedAlreadyProcessed: number;
  candidateMessages: number;
  uploadsAttempted: number;
  uploadsSucceeded: number;
  uploadsFailed: number;
  results: InvoiceScannerUploadResult[];
  errors: string[];
};

type GmailPart = gmail_v1.Schema$MessagePart;

type ExtractedDocument = {
  source: "attachment" | "html" | "link";
  fileName: string;
  buffer: Buffer;
  contentType: string;
};

function decodeBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const match = headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return typeof match?.value === "string" ? match.value.trim() : "";
}

function sanitizeFileName(name: string, fallback: string): string {
  const cleaned = name.replace(/[^\w.\-()+ ]+/g, "_").trim();
  return cleaned || fallback;
}

function isPdfAttachment(mimeType: string, fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (IMAGE_ATTACHMENT_PATTERN.test(lowerName) || mime.startsWith("image/")) {
    return false;
  }
  return mime === "application/pdf" || lowerName.endsWith(".pdf");
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function bodyHasStructuralInvoicePhrases(htmlBody: string, textBody: string): boolean {
  const plainFromHtml = stripHtmlTags(htmlBody);
  const combined = [plainFromHtml, textBody].filter(Boolean).join("\n");
  return INVOICE_STRUCTURAL_PHRASES.test(combined);
}

function extractExplicitInvoiceLinks(htmlBody: string, textBody: string): string[] {
  const urls = new Set<string>();

  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of htmlBody.matchAll(anchorPattern)) {
    const href = match[1]?.trim();
    const linkText = stripHtmlTags(match[2] ?? "");
    if (!href?.startsWith("http")) {
      continue;
    }
    if (INVOICE_LINK_CONTEXT.test(linkText)) {
      urls.add(href);
    }
  }

  const combined = `${htmlBody}\n${textBody}`;
  for (const match of combined.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const url = match[0]?.trim();
    if (!url) {
      continue;
    }
    const index = match.index ?? 0;
    const contextStart = Math.max(0, index - 140);
    const contextEnd = Math.min(combined.length, index + url.length + 140);
    const context = stripHtmlTags(combined.slice(contextStart, contextEnd));
    if (INVOICE_LINK_CONTEXT.test(context)) {
      urls.add(url);
    }
  }

  return Array.from(urls).slice(0, 3);
}

function walkParts(part: GmailPart | undefined, visit: (part: GmailPart) => void) {
  if (!part) {
    return;
  }
  visit(part);
  for (const child of part.parts ?? []) {
    walkParts(child, visit);
  }
}

async function downloadAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const response = await gmail.users.messages.attachments.get({
    userId: GMAIL_USER,
    messageId,
    id: attachmentId,
  });
  const data = response.data.data;
  if (!data) {
    throw new Error("Attachment payload was empty.");
  }
  return decodeBase64Url(data);
}

async function extractDocumentsFromMessage(
  gmail: gmail_v1.Gmail,
  message: gmail_v1.Schema$Message
): Promise<ExtractedDocument[]> {
  const messageId = message.id ?? "";
  const headers = message.payload?.headers;
  const subject = getHeader(headers, "Subject") || "(no subject)";
  const from = getHeader(headers, "From") || "unknown sender";
  const date = getHeader(headers, "Date") || new Date().toISOString();
  const documents: ExtractedDocument[] = [];
  let htmlBody = "";
  let textBody = "";

  walkParts(message.payload, (part) => {
    const mimeType = (part.mimeType ?? "").toLowerCase();
    const fileName = typeof part.filename === "string" ? part.filename.trim() : "";
    const inlineData = part.body?.data;

    if (fileName && part.body?.attachmentId) {
      return;
    }

    if (inlineData && mimeType === "text/html") {
      htmlBody += decodeBase64Url(inlineData).toString("utf8");
    } else if (inlineData && mimeType === "text/plain") {
      textBody += decodeBase64Url(inlineData).toString("utf8");
    }
  });

  const attachmentJobs: Array<Promise<void>> = [];
  walkParts(message.payload, (part) => {
    const mimeType = (part.mimeType ?? "").toLowerCase();
    const fileName = typeof part.filename === "string" ? part.filename.trim() : "";
    const attachmentId = part.body?.attachmentId;
    if (!fileName || !attachmentId || !isPdfAttachment(mimeType, fileName)) {
      return;
    }

    attachmentJobs.push(
      (async () => {
        const buffer = await downloadAttachment(gmail, messageId, attachmentId);
        documents.push({
          source: "attachment",
          fileName: sanitizeFileName(fileName, "attachment.pdf"),
          buffer,
          contentType: "application/pdf",
        });
      })()
    );
  });
  await Promise.all(attachmentJobs);

  if (documents.length === 0) {
    const html = htmlBody.trim();
    const plain = textBody.trim();
    if (bodyHasStructuralInvoicePhrases(html, plain) && (html || plain)) {
      const pdfBuffer = html
        ? htmlEmailToPdfBuffer({ subject, from, date, html })
        : htmlEmailToPdfBuffer({
            subject,
            from,
            date,
            html: `<pre>${plain.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
          });
      documents.push({
        source: "html",
        fileName: sanitizeFileName(`${subject}.pdf`, `email-${messageId}.pdf`),
        buffer: pdfBuffer,
        contentType: "application/pdf",
      });
    }
  }

  const explicitLinks = extractExplicitInvoiceLinks(htmlBody, textBody);
  for (const rawUrl of explicitLinks) {
    try {
      const downloaded = await downloadInvoiceFromUrl(rawUrl);
      if (downloaded) {
        documents.push(downloaded);
      }
    } catch (error) {
      console.warn(`[invoice-scanner] Could not download invoice link ${rawUrl}:`, error);
    }
  }

  return documents;
}

async function downloadInvoiceFromUrl(url: string): Promise<ExtractedDocument | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "PhotoshootApp-InvoiceScanner/1.0",
        Accept: "application/pdf,text/html;q=0.5,*/*;q=0.1",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return null;
    }

    if (contentType.includes("pdf")) {
      return {
        source: "link",
        fileName: sanitizeFileName(url.split("/").pop() ?? "invoice.pdf", "invoice.pdf"),
        buffer,
        contentType: "application/pdf",
      };
    }

    if (contentType.includes("html")) {
      const html = buffer.toString("utf8");
      if (!INVOICE_STRUCTURAL_PHRASES.test(stripHtmlTags(html))) {
        return null;
      }
      const pdfBuffer = htmlEmailToPdfBuffer({
        subject: "Hosted invoice",
        from: url,
        date: new Date().toISOString(),
        html,
      });
      return {
        source: "link",
        fileName: sanitizeFileName("hosted-invoice.pdf", "hosted-invoice.pdf"),
        buffer: pdfBuffer,
        contentType: "application/pdf",
      };
    }

    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildGmailQuery(timeframe: string): string {
  return [
    `newer_than:${timeframe}`,
    `(subject:Rechnung OR subject:Invoice OR subject:Quittung OR subject:Receipt OR "Rechnungsnummer" OR "Invoice Number")`,
    `-label:"${LEXOFFICE_PROCESSED_LABEL}"`,
    "-in:sent",
    "-from:me",
  ].join(" ");
}

function getWorkspaceUserEmail(): string {
  return process.env.GOOGLE_WORKSPACE_USER_EMAIL?.trim().toLowerCase() ?? "";
}

function isOutgoingMessage(fromHeader: string): boolean {
  const from = fromHeader.trim().toLowerCase();
  if (!from) {
    return false;
  }
  if (from === "me") {
    return true;
  }
  const workspaceEmail = getWorkspaceUserEmail();
  if (workspaceEmail && from.includes(workspaceEmail)) {
    return true;
  }
  return false;
}

export function normalizeInvoiceScanTimeframe(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (ALLOWED_INVOICE_SCAN_TIMEFRAMES.has(trimmed)) {
      return trimmed;
    }
  }
  return DEFAULT_INVOICE_SCAN_TIMEFRAME;
}

function messageMatchesKeywords(message: gmail_v1.Schema$Message): boolean {
  const subject = getHeader(message.payload?.headers, "Subject");
  if (SUBJECT_INVOICE_PATTERN.test(subject)) {
    return true;
  }

  const snippet = message.snippet ?? "";
  const bodyParts: string[] = [];
  walkParts(message.payload, (part) => {
    const data = part.body?.data;
    if (!data) return;
    const mime = (part.mimeType ?? "").toLowerCase();
    if (mime === "text/plain" || mime === "text/html") {
      bodyParts.push(decodeBase64Url(data).toString("utf8"));
    }
  });

  const combinedBody = bodyParts.join("\n");
  return (
    INVOICE_STRUCTURAL_PHRASES.test(combinedBody) ||
    INVOICE_STRUCTURAL_PHRASES.test(snippet) ||
    /Rechnungsnummer|Invoice Number/i.test(combinedBody) ||
    /Rechnungsnummer|Invoice Number/i.test(snippet)
  );
}

export async function runGmailInvoiceScanner(
  timeframe: string = DEFAULT_INVOICE_SCAN_TIMEFRAME
): Promise<InvoiceScannerRunResult> {
  const normalizedTimeframe = normalizeInvoiceScanTimeframe(timeframe);
  const gmail = await getGmailReadonlyClient();
  const processedLabelId = await ensureLexofficeProcessedLabel(gmail);
  const query = buildGmailQuery(normalizedTimeframe);
  const listResponse = await gmail.users.messages.list({
    userId: GMAIL_USER,
    q: query,
    maxResults: MAX_MESSAGES,
  });

  const messageRefs = listResponse.data.messages ?? [];
  const messageIds = messageRefs
    .map((ref) => ref.id?.trim())
    .filter((id): id is string => Boolean(id));
  const scannedMessageIds = await getScannedGmailMessageIds(messageIds);

  const results: InvoiceScannerUploadResult[] = [];
  const errors: string[] = [];
  let skippedAlreadyProcessed = 0;
  let candidateMessages = 0;
  let uploadsAttempted = 0;
  let uploadsSucceeded = 0;
  let uploadsFailed = 0;

  for (const ref of messageRefs) {
    const messageId = ref.id?.trim();
    if (!messageId) {
      continue;
    }

    let message: gmail_v1.Schema$Message;
    try {
      const full = await gmail.users.messages.get({
        userId: GMAIL_USER,
        id: messageId,
        format: "full",
      });
      message = full.data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`Could not load message ${messageId}: ${msg}`);
      continue;
    }

    const fromHeader = getHeader(message.payload?.headers, "From");
    if (isOutgoingMessage(fromHeader)) {
      continue;
    }

    if (messageHasProcessedLabel(message, processedLabelId) || scannedMessageIds.has(messageId)) {
      skippedAlreadyProcessed += 1;
      continue;
    }

    if (!messageMatchesKeywords(message)) {
      continue;
    }
    candidateMessages += 1;

    const subject = getHeader(message.payload?.headers, "Subject") || "(no subject)";
    let documents: ExtractedDocument[] = [];
    try {
      documents = await extractDocumentsFromMessage(gmail, message);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`Could not extract documents from "${subject}" (${messageId}): ${msg}`);
      continue;
    }

    if (documents.length === 0) {
      continue;
    }

    let messageUploadSucceeded = false;
    let messageRecorded = false;

    for (const doc of documents) {
      uploadsAttempted += 1;
      try {
        const uploaded = await uploadLexofficeVoucherFile(doc.buffer, doc.fileName, doc.contentType);
        uploadsSucceeded += 1;
        messageUploadSucceeded = true;
        results.push({
          messageId,
          subject,
          source: doc.source,
          fileName: doc.fileName,
          ok: true,
          lexofficeFileId: uploaded.fileId,
          lexofficeVoucherId: uploaded.voucherId,
        });

        if (!messageRecorded) {
          await recordScannedInvoice({
            gmailMessageId: messageId,
            fileName: doc.fileName,
            lexofficeFileId: uploaded.fileId,
          });
          messageRecorded = true;
          scannedMessageIds.add(messageId);
        }
      } catch (error) {
        uploadsFailed += 1;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(
          `[invoice-scanner] Lexoffice upload failed for message ${messageId} (${doc.fileName}):`,
          msg
        );
        results.push({
          messageId,
          subject,
          source: doc.source,
          fileName: doc.fileName,
          ok: false,
          error: msg,
        });
      }
    }

    if (messageUploadSucceeded) {
      try {
        await applyLexofficeProcessedLabel(gmail, messageId, processedLabelId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Uploaded "${subject}" but could not apply Gmail label (${messageId}): ${msg}`);
      }
    }
  }

  return {
    scannedMessages: messageRefs.length,
    skippedAlreadyProcessed,
    candidateMessages,
    uploadsAttempted,
    uploadsSucceeded,
    uploadsFailed,
    results,
    errors,
  };
}
