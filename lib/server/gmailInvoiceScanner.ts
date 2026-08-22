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
const INVOICE_KEYWORDS =
  /invoice|rechnung|receipt|quittung|beleg|zahlungsbeleg|payment confirmation/i;
const INVOICE_URL_PATTERN =
  /https?:\/\/[^\s"'<>]+(?:invoice|rechnung|receipt|quittung|beleg|bill|payment|zahlung)[^\s"'<>]*/gi;

const ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

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

function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return ".pdf";
  }
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
    if (!fileName || !attachmentId || !ATTACHMENT_MIME_TYPES.has(mimeType)) {
      return;
    }

    attachmentJobs.push(
      (async () => {
        const buffer = await downloadAttachment(gmail, messageId, attachmentId);
        documents.push({
          source: "attachment",
          fileName: sanitizeFileName(fileName, `attachment${extensionForMime(mimeType)}`),
          buffer,
          contentType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
        });
      })()
    );
  });
  await Promise.all(attachmentJobs);

  if (documents.length === 0) {
    const html = htmlBody.trim();
    const plain = textBody.trim();
    const combined = html || plain;
    const looksLikeInvoice =
      INVOICE_KEYWORDS.test(subject) ||
      INVOICE_KEYWORDS.test(combined) ||
      INVOICE_KEYWORDS.test(from);

    if (looksLikeInvoice && combined) {
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

  const linkSource = `${htmlBody}\n${textBody}`;
  const links = Array.from(new Set(linkSource.match(INVOICE_URL_PATTERN) ?? [])).slice(0, 3);
  for (const rawUrl of links) {
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
        Accept: "application/pdf,image/*,text/html;q=0.9,*/*;q=0.8",
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

    if (contentType.startsWith("image/")) {
      const ext = extensionForMime(contentType);
      return {
        source: "link",
        fileName: sanitizeFileName(`invoice-link${ext}`, `invoice-link${ext}`),
        buffer,
        contentType,
      };
    }

    if (contentType.includes("html")) {
      const html = buffer.toString("utf8");
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

function buildGmailQuery(): string {
  return [
    "newer_than:7d",
    `-label:"${LEXOFFICE_PROCESSED_LABEL}"`,
    "(invoice OR Rechnung OR receipt OR Quittung OR Beleg OR zahlungsbeleg OR \"payment confirmation\")",
  ].join(" ");
}

function messageMatchesKeywords(message: gmail_v1.Schema$Message): boolean {
  const subject = getHeader(message.payload?.headers, "Subject");
  const snippet = message.snippet ?? "";
  const plainFromParts: string[] = [];
  walkParts(message.payload, (part) => {
    const data = part.body?.data;
    if (!data) return;
    const mime = (part.mimeType ?? "").toLowerCase();
    if (mime === "text/plain" || mime === "text/html") {
      plainFromParts.push(decodeBase64Url(data).toString("utf8"));
    }
  });
  const combined = [subject, snippet, ...plainFromParts].join("\n");
  return INVOICE_KEYWORDS.test(combined);
}

export async function runGmailInvoiceScanner(): Promise<InvoiceScannerRunResult> {
  const gmail = await getGmailReadonlyClient();
  const processedLabelId = await ensureLexofficeProcessedLabel(gmail);
  const query = buildGmailQuery();
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
