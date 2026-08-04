import type { LexofficeVoucherListItem } from "@/lib/lexoffice";
import { isCrmExcludedBillingLabel, isCrmExcludedBillingTask } from "@/lib/crmTaskFilters";
import { resolveReminderClientName, resolveReminderRecipientFromTask, resolveReminderShootName, type ReminderTaskRow } from "@/lib/invoiceReminderWorkflow";

export type UnpaidBillingItemType = "lexoffice" | "credit_note";

export type UnpaidBillingItem = {
  id: string;
  type: UnpaidBillingItemType;
  clientName: string;
  /** Company / business name when available (for search). */
  companyName: string | null;
  /** Contact person full name when available (for search). */
  contactName: string | null;
  /** Invoice / voucher number when available (for search). */
  invoiceNumber: string | null;
  documentName: string;
  date: string | null;
  dateLabel: string;
  amount: number;
  clientEmail: string | null;
  canSendReminder: boolean;
  lexofficeInvoiceId: string | null;
  taskId: string | null;
  contactId: string | null;
  voucherStatus: string | null;
  linkedJobName: string | null;
};

type CreditNoteTaskRow = ReminderTaskRow & {
  client?: string | null;
  photoshoot_date?: string | null;
};

export function formatCrmBillingDateLabel(value: string | null | undefined): string {
  if (!value?.trim()) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function parseBillingDate(value: string | null | undefined): number {
  if (!value?.trim()) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : parsed.getTime();
}

function resolveOpenAmount(item: LexofficeVoucherListItem): number {
  if (typeof item.openAmount === "number" && Number.isFinite(item.openAmount)) {
    return item.openAmount;
  }
  if (typeof item.totalAmount === "number" && Number.isFinite(item.totalAmount)) {
    return item.totalAmount;
  }
  return 0;
}

export function mapLexofficeInvoiceToUnpaidBillingItem(
  item: LexofficeVoucherListItem,
  linkedTask: CreditNoteTaskRow | null
): UnpaidBillingItem | null {
  const companyName = linkedTask?.company_name?.trim() || item.contactName?.trim() || null;
  const contactName =
    [linkedTask?.contact_first_name, linkedTask?.contact_last_name]
      .map((part) => part?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .trim() || null;
  const invoiceNumber = item.voucherNumber?.trim() || null;
  const clientName = item.contactName?.trim() || companyName || contactName || "Kunde";
  if (isCrmExcludedBillingLabel(clientName)) {
    return null;
  }

  const clientEmail = resolveReminderRecipientFromTask(linkedTask);
  const contactId = item.contactId?.trim() || null;

  return {
    id: `lexoffice:${item.id}`,
    type: "lexoffice",
    clientName,
    companyName,
    contactName,
    invoiceNumber,
    documentName: invoiceNumber || "Lexoffice invoice",
    date: item.voucherDate,
    dateLabel: formatCrmBillingDateLabel(item.voucherDate),
    amount: resolveOpenAmount(item),
    clientEmail,
    canSendReminder: Boolean(clientEmail || contactId),
    lexofficeInvoiceId: item.id,
    taskId: linkedTask?.id ?? null,
    contactId,
    voucherStatus: item.voucherStatus || null,
    linkedJobName: linkedTask ? resolveReminderShootName(linkedTask) : null,
  };
}

export function mapCreditNoteTaskToUnpaidBillingItem(row: CreditNoteTaskRow): UnpaidBillingItem | null {
  if (isCrmExcludedBillingTask(row as Record<string, unknown>)) {
    return null;
  }

  const expectedRevenue = Number(row.expected_revenue ?? 0);
  if (!Number.isFinite(expectedRevenue) || expectedRevenue <= 0) {
    return null;
  }

  const clientEmail = resolveReminderRecipientFromTask(row);
  const companyName = row.company_name?.trim() || null;
  const contactName = [row.contact_first_name, row.contact_last_name]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .trim() || null;
  const invoiceNumber = row.lexoffice_invoice_id?.trim() || null;

  return {
    id: `credit_note:${row.id}`,
    type: "credit_note",
    clientName: resolveReminderClientName(row),
    companyName,
    contactName,
    invoiceNumber,
    documentName: resolveReminderShootName(row),
    date: row.photoshoot_date ?? row.invoice_date ?? null,
    dateLabel: formatCrmBillingDateLabel(row.photoshoot_date ?? row.invoice_date),
    amount: expectedRevenue,
    clientEmail,
    canSendReminder: Boolean(clientEmail),
    lexofficeInvoiceId: invoiceNumber,
    taskId: row.id,
    contactId: null,
    voucherStatus: null,
    linkedJobName: null,
  };
}

export function mergeAndSortUnpaidBillingItems(items: UnpaidBillingItem[]): UnpaidBillingItem[] {
  return [...items].sort((a, b) => parseBillingDate(a.date) - parseBillingDate(b.date));
}

export function indexTasksByLexofficeInvoiceId(tasks: CreditNoteTaskRow[]): Map<string, CreditNoteTaskRow> {
  const byInvoiceId = new Map<string, CreditNoteTaskRow>();
  for (const task of tasks) {
    const invoiceId = task.lexoffice_invoice_id?.trim();
    if (invoiceId) {
      byInvoiceId.set(invoiceId, task);
    }
  }
  return byInvoiceId;
}
