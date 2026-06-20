import type { LexofficeVoucherListItem } from "@/lib/lexoffice";
import { isCrmExcludedBillingLabel, isCrmExcludedBillingTask } from "@/lib/crmTaskFilters";
import { resolveReminderClientName, resolveReminderShootName, type ReminderTaskRow } from "@/lib/invoiceReminderWorkflow";

export type UnpaidBillingItemType = "lexoffice" | "credit_note";

export type UnpaidBillingItem = {
  id: string;
  type: UnpaidBillingItemType;
  clientName: string;
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
  const clientName = item.contactName?.trim() || linkedTask?.company_name?.trim() || "Kunde";
  if (isCrmExcludedBillingLabel(clientName)) {
    return null;
  }

  const clientEmail = linkedTask?.email?.trim() || null;
  const contactId = item.contactId?.trim() || null;

  return {
    id: `lexoffice:${item.id}`,
    type: "lexoffice",
    clientName,
    documentName: item.voucherNumber?.trim() || "Lexoffice invoice",
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

  const clientEmail = row.email?.trim() || null;

  return {
    id: `credit_note:${row.id}`,
    type: "credit_note",
    clientName: resolveReminderClientName(row),
    documentName: resolveReminderShootName(row),
    date: row.photoshoot_date ?? row.invoice_date ?? null,
    dateLabel: formatCrmBillingDateLabel(row.photoshoot_date ?? row.invoice_date),
    amount: expectedRevenue,
    clientEmail,
    canSendReminder: Boolean(clientEmail),
    lexofficeInvoiceId: row.lexoffice_invoice_id?.trim() || null,
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
