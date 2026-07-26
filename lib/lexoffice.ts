const LEXOFFICE_API_BASE_URL = "https://api.lexoffice.io/v1";
const DEFAULT_LEXOFFICE_APP_BASE_URL = "https://app.lexware.de";
const LEXOFFICE_INTER_REQUEST_DELAY_MS = 250;
const LEXOFFICE_RATE_LIMIT_RETRY_MS = [1000, 2000, 4000] as const;
const LEXOFFICE_MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let lexofficeRequestChain: Promise<unknown> = Promise.resolve();

function enqueueLexofficeRequest<T>(operation: () => Promise<T>): Promise<T> {
  const next = lexofficeRequestChain
    .then(() => sleep(LEXOFFICE_INTER_REQUEST_DELAY_MS))
    .then(operation);
  lexofficeRequestChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function lexofficeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return enqueueLexofficeRequest(async () => {
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt <= LEXOFFICE_MAX_RETRIES; attempt += 1) {
      if (attempt > 0) {
        const backoffMs = LEXOFFICE_RATE_LIMIT_RETRY_MS[attempt - 1] ?? 4000;
        await sleep(backoffMs);
      }

      const response = await fetch(input, init);
      if (response.status !== 429) {
        return response;
      }

      lastResponse = response;
      await response.text().catch(() => "");
    }

    if (!lastResponse) {
      throw new Error("Lexoffice request failed without a response.");
    }

    return lastResponse;
  });
}

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

export interface LexofficeInvoiceDetails {
  id: string;
  voucherNumber: string | null;
  voucherDate: string | null;
  voucherStatus: string | null;
  documentFileId: string | null;
  contactId: string | null;
  contactName: string | null;
}

export interface LexofficeVoucherListItem {
  id: string;
  voucherType: string;
  voucherStatus: string;
  voucherNumber: string | null;
  voucherDate: string | null;
  dueDate: string | null;
  contactId: string | null;
  contactName: string | null;
  openAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  archived: boolean;
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

interface LexofficeContactResponse {
  emailAddresses?: {
    business?: string[];
    office?: string[];
    private?: string[];
    other?: string[];
  };
  company?: {
    contactPersons?: Array<{ emailAddress?: string; primary?: boolean }>;
  };
  person?: {
    emailAddress?: string;
  };
}

interface LexofficeVoucherListResponse {
  content?: LexofficeVoucherListItem[];
  last?: boolean;
}

const UNPAID_SALES_VOUCHER_TYPES = ["invoice", "salesinvoice", "downpaymentinvoice"] as const;

interface LexofficeContactListResponse {
  content?: Array<{ id?: string }>;
}

function pickFirstEmail(values: string[] | undefined): string | null {
  if (!Array.isArray(values)) {
    return null;
  }
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function parseVoucherListItem(raw: Record<string, unknown>): LexofficeVoucherListItem | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) {
    return null;
  }

  return {
    id,
    voucherType: typeof raw.voucherType === "string" ? raw.voucherType.trim() : "",
    voucherStatus: typeof raw.voucherStatus === "string" ? raw.voucherStatus.trim() : "",
    voucherNumber: typeof raw.voucherNumber === "string" ? raw.voucherNumber.trim() : null,
    voucherDate: typeof raw.voucherDate === "string" ? raw.voucherDate.trim() : null,
    dueDate: typeof raw.dueDate === "string" ? raw.dueDate.trim() : null,
    contactId: typeof raw.contactId === "string" ? raw.contactId.trim() : null,
    contactName: typeof raw.contactName === "string" ? raw.contactName.trim() : null,
    openAmount: typeof raw.openAmount === "number" && Number.isFinite(raw.openAmount) ? raw.openAmount : null,
    totalAmount: typeof raw.totalAmount === "number" && Number.isFinite(raw.totalAmount) ? raw.totalAmount : null,
    currency: typeof raw.currency === "string" ? raw.currency.trim() : null,
    archived: raw.archived === true,
  };
}

async function fetchLexofficeVoucherListPage(params: {
  voucherStatus: "open" | "overdue";
  page: number;
  size?: number;
}): Promise<LexofficeVoucherListItem[]> {
  const apiKey = getLexofficeApiKey();
  const searchParams = new URLSearchParams({
    voucherType: UNPAID_SALES_VOUCHER_TYPES.join(","),
    voucherStatus: params.voucherStatus,
    archived: "false",
    page: String(params.page),
    size: String(params.size ?? 250),
    sort: "voucherDate,ASC",
  });

  const response = await lexofficeFetch(`${LEXOFFICE_API_BASE_URL}/voucherlist?${searchParams.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = await readLexofficeError(response);
    throw new Error(`Lexoffice voucherlist failed (${response.status} ${response.statusText}): ${detail}`);
  }

  const payload = (await response.json()) as LexofficeVoucherListResponse;

  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .map((item) => parseVoucherListItem(item as unknown as Record<string, unknown>))
    .filter((item): item is LexofficeVoucherListItem => item !== null);
}

async function fetchAllLexofficeVoucherListPages(voucherStatus: "open" | "overdue"): Promise<LexofficeVoucherListItem[]> {
  const items: LexofficeVoucherListItem[] = [];
  let page = 0;

  while (true) {
    const pageItems = await fetchLexofficeVoucherListPage({ voucherStatus, page, size: 250 });
    items.push(...pageItems);
    if (pageItems.length < 250) {
      break;
    }
    page += 1;
  }

  return items;
}

/** Fetch all open and overdue outgoing sales invoices directly from Lexoffice. */
export async function listLexofficeUnpaidSalesInvoices(): Promise<LexofficeVoucherListItem[]> {
  const openItems = await fetchAllLexofficeVoucherListPages("open");
  const overdueItems = await fetchAllLexofficeVoucherListPages("overdue");

  const byId = new Map<string, LexofficeVoucherListItem>();
  for (const item of [...openItems, ...overdueItems]) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

const lexofficeContactEmailCache = new Map<string, string | null>();

export async function getLexofficeContactEmail(contactId: string): Promise<string | null> {
  const trimmedId = contactId.trim();
  if (!trimmedId) {
    return null;
  }

  const cached = lexofficeContactEmailCache.get(trimmedId);
  if (cached !== undefined) {
    return cached;
  }

  const apiKey = getLexofficeApiKey();
  const response = await lexofficeFetch(`${LEXOFFICE_API_BASE_URL}/contacts/${encodeURIComponent(trimmedId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = await readLexofficeError(response);
    throw new Error(`Lexoffice contact lookup failed (${response.status} ${response.statusText}): ${detail}`);
  }

  const payload = (await response.json()) as LexofficeContactResponse;

  const businessEmail = pickFirstEmail(payload.emailAddresses?.business);
  const contactPersons = payload.company?.contactPersons ?? [];
  const primaryPerson = contactPersons.find((person) => person.primary === true) ?? contactPersons[0];
  const personEmail = primaryPerson?.emailAddress?.trim();

  const email =
    businessEmail ??
    personEmail ??
    pickFirstEmail(payload.emailAddresses?.office) ??
    pickFirstEmail(payload.emailAddresses?.private) ??
    pickFirstEmail(payload.emailAddresses?.other) ??
    payload.person?.emailAddress?.trim() ??
    null;

  lexofficeContactEmailCache.set(trimmedId, email);
  return email;
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

/** Resolves ISO country code dynamically — no hardcoded DE fallback. */
function resolveCountryCode(countryCode?: string, country?: string): string {
  const explicit = countryCode?.trim();
  if (explicit) {
    if (/^[a-zA-Z]{2}$/.test(explicit)) return explicit.toUpperCase();
    const mapped = COUNTRY_NAME_TO_CODE[explicit.toLowerCase()];
    if (mapped) return mapped;
    return explicit.toUpperCase();
  }

  const normalized = (country ?? "").trim();
  if (!normalized) return "";
  const mapped = COUNTRY_NAME_TO_CODE[normalized.toLowerCase()];
  if (mapped) return mapped;
  if (/^[a-zA-Z]{2}$/.test(normalized)) return normalized.toUpperCase();
  return normalized.toUpperCase();
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
  const response = await lexofficeFetch(
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
  const response = await lexofficeFetch(`${LEXOFFICE_API_BASE_URL}/contacts`, {
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
  if (!countryCode) {
    throw new Error(
      "Invoice country is required. Set the Country field on the booking (ISO code, e.g. DE)."
    );
  }

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
  const response = await lexofficeFetch(`${LEXOFFICE_API_BASE_URL}/invoices/${encodeURIComponent(invoiceId)}/document`, {
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

  const response = await lexofficeFetch(requestUrl, {
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

export function isLexofficeInvoicePaid(voucherStatus: string | null | undefined): boolean {
  const normalized = voucherStatus?.trim().toLowerCase() ?? "";
  return normalized === "paid" || normalized === "paidoff";
}

export function isLexofficeInvoiceReminderEligible(voucherStatus: string | null | undefined): boolean {
  const normalized = voucherStatus?.trim().toLowerCase() ?? "";
  return normalized === "open" || normalized === "overdue";
}

export async function getLexofficeInvoice(invoiceId: string): Promise<LexofficeInvoiceDetails> {
  const trimmedId = invoiceId.trim();
  if (!trimmedId) {
    throw new Error("invoiceId is required.");
  }

  const apiKey = getLexofficeApiKey();
  const response = await lexofficeFetch(`${LEXOFFICE_API_BASE_URL}/invoices/${encodeURIComponent(trimmedId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = await readLexofficeError(response);
    throw new Error(`Lexoffice invoice lookup failed (${response.status} ${response.statusText}): ${detail}`);
  }

  const payload = (await response.json()) as {
    id?: string;
    voucherNumber?: string;
    voucherDate?: string;
    voucherStatus?: string;
    address?: {
      contactId?: string | null;
      name?: string;
    };
  };

  let documentFileId: string | null = null;
  try {
    documentFileId = await fetchInvoiceDocumentFileId(apiKey, trimmedId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[lexoffice] Invoice ${trimmedId} loaded, but documentFileId lookup failed: ${message}`);
  }

  return {
    id: typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : trimmedId,
    voucherNumber: typeof payload.voucherNumber === "string" ? payload.voucherNumber.trim() : null,
    voucherDate: typeof payload.voucherDate === "string" ? payload.voucherDate.trim() : null,
    voucherStatus: typeof payload.voucherStatus === "string" ? payload.voucherStatus.trim() : null,
    documentFileId,
    contactId:
      typeof payload.address?.contactId === "string" && payload.address.contactId.trim()
        ? payload.address.contactId.trim()
        : null,
    contactName: typeof payload.address?.name === "string" ? payload.address.name.trim() : null,
  };
}

export async function getLexofficePdfBuffer(documentFileId: string): Promise<Buffer> {
  const trimmedId = documentFileId.trim();
  if (!trimmedId) {
    throw new Error("documentFileId is required.");
  }

  const apiKey = getLexofficeApiKey();
  const response = await lexofficeFetch(
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

export type UploadLexofficeVoucherFileResult = {
  fileId: string | null;
  voucherId: string | null;
};

/**
 * Upload a bookkeeping document into the Lexoffice Inbox via POST /v1/files.
 * Lexoffice expects multipart field `type=voucher` (not `purpose`).
 */
export async function uploadLexofficeVoucherFile(
  file: Blob | Buffer | Uint8Array,
  fileName: string
): Promise<UploadLexofficeVoucherFileResult> {
  const trimmedName = fileName.trim() || "credit-note.pdf";
  const apiKey = getLexofficeApiKey();

  const bytes =
    file instanceof Buffer
      ? file
      : file instanceof Uint8Array
        ? Buffer.from(file)
        : Buffer.from(await file.arrayBuffer());

  if (bytes.length === 0) {
    throw new Error("Credit note file is empty.");
  }
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error("Credit note file exceeds Lexoffice 5 MB limit.");
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    trimmedName.toLowerCase().endsWith(".pdf") ? trimmedName : `${trimmedName}.pdf`
  );
  // Official Lexoffice files endpoint field name is `type` with value `voucher`.
  form.append("type", "voucher");

  const response = await lexofficeFetch(`${LEXOFFICE_API_BASE_URL}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    body: form,
  });

  if (!response.ok) {
    const detail = await readLexofficeError(response);
    throw new Error(
      `Lexoffice file upload failed (${response.status} ${response.statusText}): ${detail}`
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    id?: unknown;
    voucherId?: unknown;
  } | null;

  return {
    fileId: typeof payload?.id === "string" && payload.id.trim() ? payload.id.trim() : null,
    voucherId:
      typeof payload?.voucherId === "string" && payload.voucherId.trim()
        ? payload.voucherId.trim()
        : null,
  };
}
