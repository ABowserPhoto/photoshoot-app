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
  street: string;
  zipCode: string;
  city: string;
  country: string;
  addressSupplement: string;
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
  photoshootType: string;
  shootLocation: string;
  addressSupplement?: string;
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

export function resolveCountryCode(country: string): string {
  const trimmed = country.trim();
  if (!trimmed) return "DE";
  const lower = trimmed.toLowerCase();
  if (lower === "germany" || lower === "deutschland" || lower === "de") return "DE";
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return "DE";
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

  return {
    taskId: task.id,
    shootName: buildShootDisplayName(task),
    invoiceName,
    clientName: contactPerson || invoiceName || "Client",
    clientEmail: task.email.trim(),
    photoshootType: task.photoshootType,
    shootLocation: task.shootLocation.trim(),
    ...(task.addressSupplement.trim() ? { addressSupplement: task.addressSupplement.trim() } : {}),
    clientAddress: {
      street: task.street.trim() || undefined,
      zip: task.zipCode.trim() || undefined,
      city: task.city.trim() || undefined,
      country: task.country.trim() || undefined,
      countryCode: resolveCountryCode(task.country),
    },
    lineItems: buildTaskLineItems(task),
    taxRate: Number.isFinite(task.taxPercentage) ? task.taxPercentage : 19,
    skipInvoice: task.skipInvoice,
    localFolderName: task.localFolderName.trim(),
    ...(task.lexofficeContactId.trim() ? { lexofficeContactId: task.lexofficeContactId.trim() } : {}),
  };
}
