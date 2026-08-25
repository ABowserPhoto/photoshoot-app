/**
 * Shared helpers for building the /api/workflows/finalize-shoot POST payload.
 *
 * Used by:
 *  - app/components/KanbanBoard.tsx  (manual drag to "Send Email")
 *  - app/page.tsx                    (upload-modal submit after files are saved)
 */

/** Minimal task shape required to build a finalize-shoot payload. */
export type FinalizeShootTask = {
  id: string;
  taskTitle: string;
  localFolderName: string;
  companyName: string;
  lexofficeContactId: string;
  contactFirstName: string;
  contactLastName: string;
  email: string;
  /** Comma-separated CC recipients for the delivery email draft. */
  emailCc?: string;
  street: string;
  zipCode: string;
  city: string;
  country: string;
  addressSupplement: string;
  /** Client-facing gallery URL shown on the Lexoffice invoice. */
  galleryLink?: string;
  /** When true, gallery and invoice emails are drafted to different recipients. */
  hasSeparateInvoiceEmail?: boolean;
  /** Invoice-only recipient when hasSeparateInvoiceEmail is true. */
  invoiceEmailAddress?: string;
  services: Array<{ name: string; quantity: number; price: number }>;
  products: Array<{ name: string; quantity: number; price: number }>;
  taxPercentage: number;
  /** Whether line item prices are net or gross (drives Lexoffice taxType). */
  amountType?: "Net" | "Gross";
  discount: number;
  photoshootType: string;
  shootLocation: string;
  /** ISO date (YYYY-MM-DD) for the shoot — used in separate invoice email copy. */
  photoshootDate?: string;
  skipInvoice: boolean;
};

export type FinalizeShootLineItem = {
  name: string;
  quantity: number;
  price: number;
  taxRate: number;
};

export type FinalizeShootPayload = {
  taskId: string;
  shootName: string;
  /** Billing entity / company name (invoice subject + separate-invoice greeting). */
  invoiceName: string;
  billingEntityName: string;
  /** Contact person display name (kept for Lexoffice contact person). */
  clientName: string;
  contactFirstName?: string;
  /** Contact person email — gallery/deliverables To. */
  contactEmail: string;
  /** @deprecated Use contactEmail. Kept for older callers. */
  clientEmail: string;
  /** Comma-separated CC list for gallery/deliverables. */
  ccEmails?: string;
  /** @deprecated Use ccEmails. Kept for older callers. */
  clientEmailCc?: string;
  photoshootType: string;
  shootLocation: string;
  photoshootDate?: string;
  addressSupplement?: string;
  galleryLink?: string;
  hasSeparateInvoiceEmail?: boolean;
  /** Billing entity email — separate invoice To. */
  billingEmail?: string;
  /** @deprecated Use billingEmail. Kept for older callers. */
  invoiceEmailAddress?: string;
  clientAddress: {
    street?: string;
    zip?: string;
    city?: string;
    country?: string;
    countryCode: string;
  };
  lineItems: FinalizeShootLineItem[];
  taxRate: number;
  /** Lexoffice tax mode matching booking amount type. */
  taxType?: "net" | "gross";
  skipInvoice: boolean;
  localFolderName: string;
  lexofficeContactId?: string;
};

function sumLineItems(items: Array<{ quantity: number; price: number }>): number {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.price) || 0), 0);
}

export function buildShootDisplayName(task: FinalizeShootTask): string {
  return (
    task.taskTitle.trim() ||
    [task.photoshootType, task.companyName, task.shootLocation].filter(Boolean).join(" - ") ||
    task.localFolderName.trim() ||
    "Photoshoot"
  );
}

export function buildContactPersonName(task: FinalizeShootTask): string {
  return [task.contactFirstName, task.contactLastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/** Single-line billing address for invoice pre-flight UI. */
export function formatBillingAddress(task: FinalizeShootTask): string {
  const street = task.street.trim();
  const zipCity = [task.zipCode.trim(), task.city.trim()].filter(Boolean).join(" ");
  const parts = [street, zipCity].filter(Boolean);
  if (task.country.trim()) {
    parts.push(task.country.trim());
  }
  return parts.join(", ");
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  germany: "DE",
  deutschland: "DE",
  austria: "AT",
  österreich: "AT",
  osterreich: "AT",
  switzerland: "CH",
  schweiz: "CH",
  netherlands: "NL",
  niederlande: "NL",
  belgium: "BE",
  belgien: "BE",
  france: "FR",
  frankreich: "FR",
  luxembourg: "LU",
  luxemburg: "LU",
};

/**
 * Maps a free-text country field to an ISO country code.
 * Does NOT hardcode a default — empty input stays empty so the saved
 * country value is always respected dynamically.
 */
export function resolveCountryCode(country: string): string {
  const trimmed = country.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (COUNTRY_NAME_TO_CODE[lower]) return COUNTRY_NAME_TO_CODE[lower];
  if (/^[a-zA-Z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return trimmed.toUpperCase();
}

export function calculateTaskInvoiceNetPrice(task: FinalizeShootTask): number {
  const subtotal = sumLineItems(task.services) + sumLineItems(task.products);
  const adjusted = Math.max(0, subtotal - (Number(task.discount) || 0));
  const taxRate = (Number.isFinite(task.taxPercentage) ? task.taxPercentage : 0) / 100;
  if (task.amountType === "Gross") {
    return taxRate > 0 ? adjusted / (1 + taxRate) : adjusted;
  }
  return adjusted;
}

export function buildTaskLineItems(task: FinalizeShootTask): FinalizeShootLineItem[] {
  const taxRate = Number.isFinite(task.taxPercentage) ? task.taxPercentage : 19;
  const items = [...task.services, ...task.products]
    .map((item) => {
      const name = item.name.trim();
      if (!name) return null;
      return {
        name,
        quantity: Number(item.quantity) || 1,
        price: Number(item.price) || 0,
        taxRate,
      };
    })
    .filter((item): item is FinalizeShootLineItem => Boolean(item));

  if (task.discount > 0) {
    items.push({
      name: "Discount",
      quantity: 1,
      price: -Math.abs(Number(task.discount) || 0),
      taxRate,
    });
  }

  if (items.length > 0) return items;

  return [
    {
      name: `Photoshoot: ${buildShootDisplayName(task)}`,
      quantity: 1,
      price: calculateTaskInvoiceNetPrice(task),
      taxRate,
    },
  ];
}

export type InvoicePreflightLineItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type InvoicePreflightSummary = {
  billingEntityName: string;
  billingAddress: string;
  contactPersonName: string;
  skipInvoice: boolean;
  taxRate: number;
  taxType: "net" | "gross";
  lineItems: InvoicePreflightLineItem[];
  subtotalNet: number;
  subtotalGross: number;
  taxAmount: number;
  warnings: string[];
};

export function buildInvoicePreflightSummary(task: FinalizeShootTask): InvoicePreflightSummary {
  const billingEntityName = task.companyName.trim();
  const contactPersonName = buildContactPersonName(task);
  const taxRate = Number.isFinite(task.taxPercentage) ? task.taxPercentage : 19;
  const taxType: "net" | "gross" = task.amountType === "Gross" ? "gross" : "net";
  const taxMultiplier = taxRate / 100;
  const rawLineItems = buildTaskLineItems(task);

  const lineItems: InvoicePreflightLineItem[] = rawLineItems.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.price,
    lineTotal: item.quantity * item.price,
  }));

  const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const subtotalNet = taxType === "gross" && taxMultiplier > 0 ? subtotal / (1 + taxMultiplier) : subtotal;
  const subtotalGross = taxType === "net" ? subtotal * (1 + taxMultiplier) : subtotal;
  const taxAmount = subtotalGross - subtotalNet;

  const warnings: string[] = [];
  if (!task.skipInvoice && !billingEntityName) {
    warnings.push("Billing entity / company name is required for the Lexoffice invoice.");
  }
  if (!task.skipInvoice && !resolveCountryCode(task.country)) {
    warnings.push("Country is required on the booking for Lexoffice (e.g. DE).");
  }
  if (!task.skipInvoice && !formatBillingAddress(task)) {
    warnings.push("Billing address (street, zip, city) is missing.");
  }

  return {
    billingEntityName,
    billingAddress: formatBillingAddress(task),
    contactPersonName,
    skipInvoice: task.skipInvoice,
    taxRate,
    taxType,
    lineItems,
    subtotalNet,
    subtotalGross,
    taxAmount,
    warnings,
  };
}

export function buildFinalizeShootPayload(task: FinalizeShootTask): FinalizeShootPayload {
  const billingEntityName = task.companyName.trim();
  const contactPerson = buildContactPersonName(task);
  const contactEmail = task.email.trim();
  const ccEmails = (task.emailCc ?? "").trim();
  const galleryLink = (task.galleryLink ?? "").trim();
  const countryCode = resolveCountryCode(task.country);
  const hasSeparateInvoiceEmail = Boolean(task.hasSeparateInvoiceEmail);
  const billingEmail = (task.invoiceEmailAddress ?? "").trim();

  return {
    taskId: task.id,
    shootName: buildShootDisplayName(task),
    invoiceName: billingEntityName,
    billingEntityName,
    clientName: contactPerson || billingEntityName || "Client",
    ...(task.contactFirstName.trim() ? { contactFirstName: task.contactFirstName.trim() } : {}),
    contactEmail,
    clientEmail: contactEmail,
    ...(ccEmails ? { ccEmails, clientEmailCc: ccEmails } : {}),
    photoshootType: task.photoshootType,
    shootLocation: task.shootLocation.trim(),
    ...(task.photoshootDate?.trim() ? { photoshootDate: task.photoshootDate.trim() } : {}),
    ...(task.addressSupplement.trim() ? { addressSupplement: task.addressSupplement.trim() } : {}),
    ...(galleryLink ? { galleryLink } : {}),
    ...(hasSeparateInvoiceEmail
      ? {
          hasSeparateInvoiceEmail: true,
          ...(billingEmail ? { billingEmail, invoiceEmailAddress: billingEmail } : {}),
        }
      : {}),
    clientAddress: {
      street: task.street.trim() || undefined,
      zip: task.zipCode.trim() || undefined,
      city: task.city.trim() || undefined,
      country: task.country.trim() || undefined,
      countryCode,
    },
    lineItems: buildTaskLineItems(task),
    taxRate: Number.isFinite(task.taxPercentage) ? task.taxPercentage : 19,
    taxType: task.amountType === "Gross" ? "gross" : "net",
    skipInvoice: task.skipInvoice,
    localFolderName: task.localFolderName.trim(),
    ...(task.lexofficeContactId.trim() ? { lexofficeContactId: task.lexofficeContactId.trim() } : {}),
  };
}
