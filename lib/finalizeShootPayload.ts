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
  discount: number;
  photoshootType: string;
  shootLocation: string;
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
  invoiceName: string;
  clientName: string;
  clientEmail: string;
  clientEmailCc?: string;
  photoshootType: string;
  shootLocation: string;
  addressSupplement?: string;
  galleryLink?: string;
  hasSeparateInvoiceEmail?: boolean;
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
  return Math.max(0, subtotal - (Number(task.discount) || 0));
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

export function buildFinalizeShootPayload(task: FinalizeShootTask): FinalizeShootPayload {
  const invoiceName = task.companyName.trim();
  const contactPerson = buildContactPersonName(task);
  const galleryLink = (task.galleryLink ?? "").trim();
  const emailCc = (task.emailCc ?? "").trim();
  const countryCode = resolveCountryCode(task.country);
  const hasSeparateInvoiceEmail = Boolean(task.hasSeparateInvoiceEmail);
  const invoiceEmailAddress = (task.invoiceEmailAddress ?? "").trim();

  return {
    taskId: task.id,
    shootName: buildShootDisplayName(task),
    invoiceName,
    clientName: contactPerson || invoiceName || "Client",
    clientEmail: task.email.trim(),
    ...(emailCc ? { clientEmailCc: emailCc } : {}),
    photoshootType: task.photoshootType,
    shootLocation: task.shootLocation.trim(),
    ...(task.addressSupplement.trim() ? { addressSupplement: task.addressSupplement.trim() } : {}),
    ...(galleryLink ? { galleryLink } : {}),
    ...(hasSeparateInvoiceEmail
      ? {
          hasSeparateInvoiceEmail: true,
          ...(invoiceEmailAddress ? { invoiceEmailAddress } : {}),
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
    skipInvoice: task.skipInvoice,
    localFolderName: task.localFolderName.trim(),
    ...(task.lexofficeContactId.trim() ? { lexofficeContactId: task.lexofficeContactId.trim() } : {}),
  };
}
