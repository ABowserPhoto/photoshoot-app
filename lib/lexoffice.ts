const LEXOFFICE_API_BASE_URL = "https://api.lexoffice.io/v1";
const DEFAULT_LEXOFFICE_APP_BASE_URL = "https://app.lexware.de";

export interface LexofficeClientDetails {
  /** Exact billing name printed on the invoice address block. */
  invoiceName: string;
  email?: string;
  /** Optional contact person for Lexoffice contact records (not used as invoice name). */
  contactPersonName?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  addressSupplement?: string;
  /** Existing Lexoffice contact UUID; when set, address still requires name and countryCode. */
  contactId?: string;
}

export interface LexofficeInvoiceLineItem {
  name: string;
  quantity: number;
  price: number;
  taxRate: number;
  unitName?: string;
}

export interface CreateLexofficeInvoiceData {
  client: LexofficeClientDetails;
  lineItems: LexofficeInvoiceLineItem[];
  /** Defaults to `net`. Use `gross` when unit prices include VAT. */
  taxType?: "net" | "gross";
  currency?: string;
  voucherDate?: Date | string;
  introduction?: string;
  remark?: string;
  paymentTermDuration?: number;
  /** When true, invoice is finalized (`open`) and a PDF can be rendered immediately. */
  finalize?: boolean;
}

export interface CreateLexofficeContactData {
  email: string;
  invoiceName?: string;
  contactPersonName?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  addressSupplement?: string;
}

export interface CreateLexofficeInvoiceResult {
  id: string;
  documentFileId: string | null;
  resourceUri: string | null;
  invoiceViewUrl: string;
}

interface LexofficeCreateResourceResponse {
  id?: string;
  resourceUri?: string;
  createdDate?: string;
  updatedDate?: string;
  version?: number;
}

interface LexofficeDocumentResponse {
  documentFileId?: string;
}

interface LexofficeContactListResponse {
  content?: Array<{ id?: string }>;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function getLexofficeApiKey(): string {
  return requiredEnv("LEXOFFICE_API_KEY");
}

function buildLexofficeInvoiceViewUrl(invoiceId: string): string {
  const base = process.env.LEXOFFICE_APP_BASE_URL?.trim() || DEFAULT_LEXOFFICE_APP_BASE_URL;
  return `${base.replace(/\/$/, "")}/permalink/invoices/view/${encodeURIComponent(invoiceId)}`;
}

function resolveCountryCode(countryCode?: string, country?: string): string {
  const explicit = countryCode?.trim().toUpperCase();
  if (explicit) {
    return explicit;
  }

  const normalized = (country ?? "").trim().toLowerCase();
  if (!normalized || normalized === "germany" || normalized === "deutschland" || normalized === "de") {
    return "DE";
  }
  if (normalized.length === 2) {
    return normalized.toUpperCase();
  }

  return "DE";
}

function splitPersonName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "Client" };
  }
  if (parts.length === 1) {
    return { firstName: "", lastName: parts[0] };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function formatLexofficeDateTime(value: Date | string | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid voucherDate for Lexoffice invoice.");
  }

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const minutes = String(absOffset % 60).padStart(2, "0");

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}T00:00:00.000${sign}${hours}:${minutes}`;
}

async function readLexofficeError(response: Response): Promise<string> {
  const responseText = await response.text();
  if (!responseText.trim()) {
    return `HTTP ${response.status} ${response.statusText}`;
  }

  try {
    const payload = JSON.parse(responseText) as {
      message?: string;
      error?: string;
      issues?: Array<{ message?: string; path?: string[] }>;
    };

    const issueMessages = Array.isArray(payload.issues)
      ? payload.issues
          .map((issue) => {
            const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "request";
            return issue.message ? `${path}: ${issue.message}` : null;
          })
          .filter((message): message is string => Boolean(message))
      : [];

    const parts = [payload.message, payload.error, ...issueMessages, responseText].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0
    );

    return parts.length > 0 ? parts.join(" | ") : `HTTP ${response.status} ${response.statusText}`;
  } catch {
    return responseText.trim();
  }
}

function buildBillingAddress(data: {
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  addressSupplement?: string;
}) {
  const countryCode = resolveCountryCode(data.countryCode, data.country);
  const street = data.street?.trim();
  const zip = data.zip?.trim();
  const city = data.city?.trim();
  const supplement = data.addressSupplement?.trim();

  if (!street && !zip && !city && !supplement) {
    return undefined;
  }

  return {
    ...(supplement ? { supplement } : {}),
    ...(street ? { street } : {}),
    ...(zip ? { zip } : {}),
    ...(city ? { city } : {}),
    countryCode,
  };
}

export async function findLexofficeContactByEmail(email: string): Promise<string | null> {
  const trimmedEmail = email.trim();
  if (trimmedEmail.length < 3) {
    return null;
  }

  const apiKey = getLexofficeApiKey();
  const response = await fetch(
    `${LEXOFFICE_API_BASE_URL}/contacts?email=${encodeURIComponent(trimmedEmail)}&customer=true`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const detail = await readLexofficeError(response);
    throw new Error(`Lexoffice contact lookup failed (${response.status} ${response.statusText}): ${detail}`);
  }

  const payload = (await response.json()) as LexofficeContactListResponse;
  const firstMatch = Array.isArray(payload.content) ? payload.content[0] : undefined;
  const id = typeof firstMatch?.id === "string" ? firstMatch.id.trim() : "";
  return id || null;
}

export async function createLexofficeContact(data: CreateLexofficeContactData): Promise<string> {
  const email = data.email.trim();
  if (!email) {
    throw new Error("Contact email is required.");
  }

  const existingId = await findLexofficeContactByEmail(email);
  if (existingId) {
    return existingId;
  }

  const invoiceName = data.invoiceName?.trim();
  const contactPersonName = (data.contactPersonName?.trim() || invoiceName || "Client").trim();
  const { firstName, lastName } = splitPersonName(contactPersonName);
  const billingAddress = buildBillingAddress(data);

  const requestBody = invoiceName
    ? {
        version: 0,
        roles: { customer: {} },
        company: {
          name: invoiceName,
          contactPersons: [
            {
              ...(firstName ? { firstName } : {}),
              lastName,
              emailAddress: email,
            },
          ],
        },
        ...(billingAddress
          ? {
              addresses: {
                billing: [billingAddress],
              },
            }
          : {}),
        emailAddresses: {
          business: [email],
        },
      }
    : {
        version: 0,
        roles: { customer: {} },
        person: {
          ...(firstName ? { firstName } : {}),
          lastName,
        },
        ...(billingAddress
          ? {
              addresses: {
                billing: [billingAddress],
              },
            }
          : {}),
        emailAddresses: {
          business: [email],
        },
      };

  const apiKey = getLexofficeApiKey();
  const response = await fetch(`${LEXOFFICE_API_BASE_URL}/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const detail = await readLexofficeError(response);
    throw new Error(`Lexoffice contact creation failed (${response.status} ${response.statusText}): ${detail}`);
  }

  const created = (await response.json()) as LexofficeCreateResourceResponse;
  const id = typeof created.id === "string" ? created.id.trim() : "";
  if (!id) {
    throw new Error("Lexoffice contact creation succeeded but no contact id was returned.");
  }

  return id;
}

async function resolveLexofficeContactId(client: LexofficeClientDetails): Promise<string | null> {
  const explicitContactId = client.contactId?.trim();
  if (explicitContactId) {
    return explicitContactId;
  }

  const email = client.email?.trim();
  if (!email) {
    return null;
  }

  const existingId = await findLexofficeContactByEmail(email);
  if (existingId) {
    return existingId;
  }

  const invoiceName = client.invoiceName.trim();
  const contactPersonName = client.contactPersonName?.trim() || invoiceName || "Client";

  return createLexofficeContact({
    email,
    invoiceName,
    contactPersonName,
    street: client.street,
    zip: client.zip,
    city: client.city,
    country: client.country,
    countryCode: client.countryCode,
    addressSupplement: client.addressSupplement,
  });
}

function buildLexofficeInvoicePayload(invoiceData: CreateLexofficeInvoiceData, contactId: string | null) {
  const { client, lineItems, taxType = "net", currency = "EUR" } = invoiceData;

  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new Error("At least one invoice line item is required.");
  }

  const invoiceName = client.invoiceName.trim();
  if (!invoiceName) {
    throw new Error("invoiceName is required.");
  }

  const countryCode = resolveCountryCode(client.countryCode, client.country);

  const mappedLineItems = lineItems.map((item) => {
    const name = item.name.trim();
    if (!name) {
      throw new Error("Each line item must include a name.");
    }

    const quantity = Number(item.quantity);
    const unitPrice = Number(item.price);
    const taxRate = Number(item.taxRate);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for line item "${name}".`);
    }
    if (!Number.isFinite(unitPrice)) {
      throw new Error(`Invalid price for line item "${name}".`);
    }
    if (!Number.isFinite(taxRate) || taxRate < 0) {
      throw new Error(`Invalid tax rate for line item "${name}".`);
    }

    const unitPricePayload =
      taxType === "gross"
        ? {
            currency,
            grossAmount: unitPrice,
            taxRatePercentage: taxRate,
          }
        : {
            currency,
            netAmount: unitPrice,
            taxRatePercentage: taxRate,
          };

    return {
      type: "custom" as const,
      name,
      quantity,
      unitName: "Stück",
      unitPrice: unitPricePayload,
    };
  });

  const address = {
    ...(contactId ? { contactId } : {}),
    name: invoiceName,
    countryCode,
    ...(client.addressSupplement?.trim() ? { supplement: client.addressSupplement.trim() } : {}),
    ...(client.street?.trim() ? { street: client.street.trim() } : {}),
    ...(client.zip?.trim() ? { zip: client.zip.trim() } : {}),
    ...(client.city?.trim() ? { city: client.city.trim() } : {}),
  };

  return {
    archived: false,
    voucherDate: formatLexofficeDateTime(invoiceData.voucherDate),
    address,
    lineItems: mappedLineItems,
    totalPrice: { currency },
    taxConditions: { taxType },
    shippingConditions: {
      shippingType: "none" as const,
    },
    ...(invoiceData.introduction?.trim()
      ? { introduction: invoiceData.introduction.trim() }
      : {}),
    ...(invoiceData.remark?.trim() ? { remark: invoiceData.remark.trim() } : {}),
    ...(typeof invoiceData.paymentTermDuration === "number" && invoiceData.paymentTermDuration > 0
      ? {
          paymentConditions: {
            paymentTermLabel: `Zahlbar in ${invoiceData.paymentTermDuration} Tagen`,
            paymentTermDuration: invoiceData.paymentTermDuration,
          },
        }
      : {}),
  };
}

async function fetchInvoiceDocumentFileId(apiKey: string, invoiceId: string): Promise<string | null> {
  const response = await fetch(`${LEXOFFICE_API_BASE_URL}/invoices/${encodeURIComponent(invoiceId)}/document`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const detail = await readLexofficeError(response);
    throw new Error(`Lexoffice document lookup failed for invoice ${invoiceId}: ${detail}`);
  }

  const payload = (await response.json()) as LexofficeDocumentResponse;
  const documentFileId = typeof payload.documentFileId === "string" ? payload.documentFileId.trim() : "";
  return documentFileId || null;
}

export async function createLexofficeInvoice(
  invoiceData: CreateLexofficeInvoiceData
): Promise<CreateLexofficeInvoiceResult> {
  const apiKey = getLexofficeApiKey();
  const finalize = invoiceData.finalize ?? false;
  const contactId = await resolveLexofficeContactId(invoiceData.client);
  const requestUrl = `${LEXOFFICE_API_BASE_URL}/invoices${finalize ? "?finalize=true" : ""}`;
  const requestBody = buildLexofficeInvoicePayload(invoiceData, contactId);

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const detail = await readLexofficeError(response);
    throw new Error(`Lexoffice invoice creation failed (${response.status} ${response.statusText}): ${detail}`);
  }

  const created = (await response.json()) as LexofficeCreateResourceResponse;
  const id = typeof created.id === "string" ? created.id.trim() : "";
  if (!id) {
    throw new Error("Lexoffice invoice creation succeeded but no invoice id was returned.");
  }

  const resourceUri =
    typeof created.resourceUri === "string" && created.resourceUri.trim() ? created.resourceUri.trim() : null;
  const invoiceViewUrl = buildLexofficeInvoiceViewUrl(id);

  let documentFileId: string | null = null;
  try {
    documentFileId = await fetchInvoiceDocumentFileId(apiKey, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (finalize) {
      throw new Error(message);
    }
    console.warn(`[lexoffice] Invoice ${id} created, but documentFileId is not available yet: ${message}`);
  }

  return { id, documentFileId, resourceUri, invoiceViewUrl };
}

export async function getLexofficePdfBuffer(documentFileId: string): Promise<Buffer> {
  const trimmedId = documentFileId.trim();
  if (!trimmedId) {
    throw new Error("documentFileId is required.");
  }

  const apiKey = getLexofficeApiKey();
  const response = await fetch(
    `${LEXOFFICE_API_BASE_URL}/files/${encodeURIComponent(trimmedId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/pdf",
      },
    }
  );

  if (!response.ok) {
    const detail = await readLexofficeError(response);
    throw new Error(
      `Lexoffice PDF download failed (${response.status} ${response.statusText}): ${detail}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new Error("Lexoffice PDF download returned an empty file.");
  }

  return buffer;
}
