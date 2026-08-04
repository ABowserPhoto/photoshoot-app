import type { SupabaseClient } from "@supabase/supabase-js";

import { createGmailDraft, normalizeGmailRecipient } from "@/lib/google";
import { generateInvoiceReminderEmail } from "@/lib/invoiceReminderAi";
import {
  getLexofficeContactEmail,
  getLexofficeInvoice,
  getLexofficePdfBuffer,
  isLexofficeInvoicePaid,
  isLexofficeInvoiceReminderEligible,
} from "@/lib/lexoffice";

export type ReminderTaskRow = {
  id: string;
  title: string | null;
  company_name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  has_separate_invoice_email?: boolean | null;
  invoice_email_address?: string | null;
  photoshoot_type: string | null;
  shoot_location: string | null;
  photoshoot_date: string | null;
  lexoffice_invoice_id: string | null;
  lexoffice_document_file_id: string | null;
  invoice_date: string | null;
  is_paid: boolean | null;
  skip_invoice: boolean | null;
  expected_revenue: number | null;
  is_credit_note: boolean | null;
};

export type CreateReminderDraftResult =
  | { ok: true; gmailDraftId: string; invoiceNumber: string | null; markedPaid: false }
  | { ok: true; markedPaid: true }
  | { ok: false; error: string; code?: "missing_email" | "missing_invoice" | "not_eligible" | "already_paid" };

function parseDate(value: string | null | undefined): Date | null {
  if (!value?.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveReminderClientName(row: ReminderTaskRow): string {
  const company = row.company_name?.trim();
  if (company) {
    return company;
  }
  const contact = [row.contact_first_name, row.contact_last_name]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return contact || "Kunde";
}

/** Greeting name: contact person if present, otherwise business/company name. */
export function resolveReminderGreetingName(row: ReminderTaskRow): string {
  const contact = [row.contact_first_name, row.contact_last_name]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  if (contact) {
    return contact;
  }
  return row.company_name?.trim() || "Kunde";
}

export function resolveReminderShootName(row: ReminderTaskRow): string {
  const title = row.title?.trim();
  if (title) {
    return title;
  }
  const parts = [row.photoshoot_type?.trim(), row.shoot_location?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" – ") : "Fotoshooting";
}

/**
 * Extract a bare email address suitable for a Gmail `To` header.
 * Converts IDN domains (e.g. `ß`) to punycode so Gmail accepts the header.
 */
export function normalizeReminderRecipientEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return normalizeGmailRecipient(value);
}

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  if (typeof value === "number") return value === 1;
  return false;
}

/** Prefer separate invoice email when configured; otherwise primary task email. */
export function resolveReminderRecipientFromTask(task: ReminderTaskRow | null | undefined): string | null {
  if (!task) {
    return null;
  }

  if (isTruthyFlag(task.has_separate_invoice_email)) {
    const invoiceEmail = normalizeReminderRecipientEmail(task.invoice_email_address);
    if (invoiceEmail) {
      return invoiceEmail;
    }
  }

  return normalizeReminderRecipientEmail(task.email);
}

export async function resolveLexofficeReminderRecipient(
  task: ReminderTaskRow | null,
  contactId: string | null | undefined
): Promise<string | null> {
  const fromTask = resolveReminderRecipientFromTask(task);
  if (fromTask) {
    return fromTask;
  }

  const trimmedContactId = contactId?.trim();
  if (!trimmedContactId) {
    return null;
  }

  return normalizeReminderRecipientEmail(await getLexofficeContactEmail(trimmedContactId));
}

function requireReminderRecipientEmail(value: string | null | undefined): string {
  const email = normalizeReminderRecipientEmail(value);
  if (!email) {
    throw new Error("Cannot create reminder draft: No valid email address found for this client.");
  }
  return email;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "Rechnung";
}

export async function createInvoiceReminderDraftForTask(
  supabase: SupabaseClient,
  task: ReminderTaskRow,
  options?: { skipOverdueCheck?: boolean; lexofficeContactId?: string | null }
): Promise<CreateReminderDraftResult> {
  const taskId = task.id;
  const invoiceId = task.lexoffice_invoice_id?.trim() ?? "";
  let invoiceNumber = invoiceId || "Rechnung";
  let documentFileId = task.lexoffice_document_file_id?.trim() || "";
  let invoiceDate = parseDate(task.invoice_date);
  let lexofficeContactId = options?.lexofficeContactId?.trim() || "";

  if (invoiceId) {
    const invoice = await getLexofficeInvoice(invoiceId);

    if (isLexofficeInvoicePaid(invoice.voucherStatus)) {
      await supabase
        .from("tasks")
        .update({
          is_paid: true,
          invoice_paid: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);
      return { ok: true, markedPaid: true };
    }

    if (
      !options?.skipOverdueCheck &&
      !isLexofficeInvoiceReminderEligible(invoice.voucherStatus)
    ) {
      return {
        ok: false,
        error: `Lexoffice status "${invoice.voucherStatus ?? "unknown"}" is not eligible for reminders.`,
        code: "not_eligible",
      };
    }

    invoiceNumber = invoice.voucherNumber ?? invoiceId;
    documentFileId = documentFileId || invoice.documentFileId?.trim() || "";
    invoiceDate = parseDate(invoice.voucherDate) ?? invoiceDate;
    lexofficeContactId = lexofficeContactId || invoice.contactId?.trim() || "";
  } else if (Number(task.expected_revenue ?? 0) > 0 || task.is_credit_note) {
    invoiceNumber = "Credit Note";
    invoiceDate = invoiceDate ?? new Date();
  } else {
    return { ok: false, error: "No Lexoffice invoice or credit-note amount on this task.", code: "missing_invoice" };
  }

  const resolvedRecipient = await resolveLexofficeReminderRecipient(task, lexofficeContactId || null);
  if (!resolvedRecipient) {
    return { ok: false, error: "Client email is missing on this task.", code: "missing_email" };
  }
  const recipient = requireReminderRecipientEmail(resolvedRecipient);

  const reminder = generateInvoiceReminderEmail({
    invoiceNumber,
    clientName: resolveReminderClientName(task),
    contactNameOrBusinessName: resolveReminderGreetingName(task),
    photoshootDate: task.photoshoot_date?.trim() || task.invoice_date?.trim() || undefined,
  });

  let pdfBuffer: Buffer | undefined;
  if (documentFileId) {
    try {
      pdfBuffer = await getLexofficePdfBuffer(documentFileId);
    } catch (pdfError) {
      console.warn(
        `[invoice-reminder] Could not attach PDF for task ${taskId}:`,
        pdfError instanceof Error ? pdfError.message : pdfError
      );
    }
  }

  const attachmentFileName = pdfBuffer
    ? `Rechnung-${sanitizeFileName(invoiceNumber === "Credit Note" ? resolveReminderShootName(task) : invoiceNumber)}.pdf`
    : undefined;

  const gmailDraft = await createGmailDraft(
    recipient,
    reminder.subject,
    reminder.bodyHtml,
    pdfBuffer,
    attachmentFileName,
    { plainTextFallback: reminder.bodyPlain }
  );

  await supabase
    .from("tasks")
    .update({
      ...(invoiceDate ? { invoice_date: invoiceDate.toISOString() } : {}),
      ...(documentFileId ? { lexoffice_document_file_id: documentFileId } : {}),
      invoice_reminder_drafted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  return {
    ok: true,
    gmailDraftId: gmailDraft.id,
    invoiceNumber: invoiceNumber === "Credit Note" ? null : invoiceNumber,
    markedPaid: false,
  };
}

export async function createInvoiceReminderDraftForLexofficeInvoice(
  supabase: SupabaseClient,
  lexofficeInvoiceId: string,
  linkedTask: ReminderTaskRow | null,
  options?: { skipOverdueCheck?: boolean }
): Promise<CreateReminderDraftResult> {
  const trimmedInvoiceId = lexofficeInvoiceId.trim();
  if (!trimmedInvoiceId) {
    return { ok: false, error: "lexofficeInvoiceId is required.", code: "missing_invoice" };
  }

  if (linkedTask) {
    const mergedTask: ReminderTaskRow = {
      ...linkedTask,
      lexoffice_invoice_id: trimmedInvoiceId,
    };
    return createInvoiceReminderDraftForTask(supabase, mergedTask, options);
  }

  const invoice = await getLexofficeInvoice(trimmedInvoiceId);

  if (isLexofficeInvoicePaid(invoice.voucherStatus)) {
    return { ok: true, markedPaid: true };
  }

  if (!options?.skipOverdueCheck && !isLexofficeInvoiceReminderEligible(invoice.voucherStatus)) {
    return {
      ok: false,
      error: `Lexoffice status "${invoice.voucherStatus ?? "unknown"}" is not eligible for reminders.`,
      code: "not_eligible",
    };
  }

  const resolvedRecipient = await resolveLexofficeReminderRecipient(null, invoice.contactId);
  if (!resolvedRecipient) {
    return { ok: false, error: "Client email is missing for this Lexoffice invoice.", code: "missing_email" };
  }
  const recipient = requireReminderRecipientEmail(resolvedRecipient);

  const invoiceNumber = invoice.voucherNumber ?? trimmedInvoiceId;
  const clientName = invoice.contactName?.trim() || "Kunde";

  const reminder = generateInvoiceReminderEmail({
    invoiceNumber,
    clientName,
    contactNameOrBusinessName: clientName,
    photoshootDate: invoice.voucherDate?.trim() || undefined,
  });

  let pdfBuffer: Buffer | undefined;
  const documentFileId = invoice.documentFileId?.trim() || "";
  if (documentFileId) {
    try {
      pdfBuffer = await getLexofficePdfBuffer(documentFileId);
    } catch (pdfError) {
      console.warn(
        `[invoice-reminder] Could not attach PDF for Lexoffice invoice ${trimmedInvoiceId}:`,
        pdfError instanceof Error ? pdfError.message : pdfError
      );
    }
  }

  const attachmentFileName = pdfBuffer
    ? `Rechnung-${sanitizeFileName(invoiceNumber)}.pdf`
    : undefined;

  const gmailDraft = await createGmailDraft(
    recipient,
    reminder.subject,
    reminder.bodyHtml,
    pdfBuffer,
    attachmentFileName,
    { plainTextFallback: reminder.bodyPlain }
  );

  return {
    ok: true,
    gmailDraftId: gmailDraft.id,
    invoiceNumber,
    markedPaid: false,
  };
}
