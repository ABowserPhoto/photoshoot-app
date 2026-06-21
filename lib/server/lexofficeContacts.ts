import { createClient } from "@supabase/supabase-js";

const LEXOFFICE_API_BASE_URL = "https://api.lexoffice.io/v1";

export type ContactPerson = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
};

interface LexofficeApiContactPerson {
  salutation?: string;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  phoneNumber?: string;
  primary?: boolean;
}

interface LexofficeApiContact {
  id?: string;
  version?: number;
  roles?: {
    customer?: Record<string, unknown>;
    vendor?: Record<string, unknown>;
  };
  company?: {
    name?: string;
    contactPersons?: LexofficeApiContactPerson[];
  };
  person?: {
    salutation?: string;
    firstName?: string;
    lastName?: string;
  };
  addresses?: {
    billing?: Array<{
      street?: string;
      zip?: string;
      city?: string;
      countryCode?: string;
    }>;
  };
  emailAddresses?: {
    business?: string[];
    office?: string[];
    private?: string[];
    other?: string[];
  };
  phoneNumbers?: {
    business?: string[];
    mobile?: string[];
    private?: string[];
    fax?: string[];
  };
  archived?: boolean;
}

interface LexofficeContactListResponse {
  content?: LexofficeApiContact[];
  totalPages?: number;
  totalElements?: number;
  last?: boolean;
  number?: number;
}

export type LexofficeSyncResult = {
  synced: number;
  errors: string[];
};

export type LexofficePushResult = { ok: true; lexofficeId: string } | { ok: false; error: string };

function getLexofficeApiKey(): string {
  const key = process.env.LEXOFFICE_API_KEY?.trim();
  if (!key) {
    throw new Error("LEXOFFICE_API_KEY environment variable is not set.");
  }
  return key;
}

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function pickFirstString(arr: string[] | undefined): string {
  if (!Array.isArray(arr)) {
    return "";
  }
  for (const item of arr) {
    const trimmed = item?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function extractEmailFromContact(contact: LexofficeApiContact): string {
  const biz = pickFirstString(contact.emailAddresses?.business);
  if (biz) return biz;
  const office = pickFirstString(contact.emailAddresses?.office);
  if (office) return office;
  if (contact.company?.contactPersons?.length) {
    const primary = contact.company.contactPersons.find((p) => p.primary) ?? contact.company.contactPersons[0];
    if (primary?.emailAddress?.trim()) {
      return primary.emailAddress.trim();
    }
  }
  return "";
}

function extractPhoneFromContact(contact: LexofficeApiContact): string {
  const biz = pickFirstString(contact.phoneNumbers?.business);
  if (biz) return biz;
  const mobile = pickFirstString(contact.phoneNumbers?.mobile);
  if (mobile) return mobile;
  return "";
}

function extractContactPersons(contact: LexofficeApiContact): ContactPerson[] {
  if (!contact.company?.contactPersons?.length) {
    return [];
  }
  return contact.company.contactPersons.map((cp, i) => ({
    id: String(i),
    name: [cp.firstName?.trim(), cp.lastName?.trim()].filter(Boolean).join(" "),
    email: cp.emailAddress?.trim() ?? "",
    phone: cp.phoneNumber?.trim() ?? "",
    role: cp.primary ? "Primary" : "",
  }));
}

async function fetchLexofficeContactsPage(
  apiKey: string,
  page: number
): Promise<LexofficeContactListResponse> {
  const params = new URLSearchParams({
    customer: "true",
    page: String(page),
    size: "250",
  });
  const response = await fetch(`${LEXOFFICE_API_BASE_URL}/contacts?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Lexoffice contacts fetch failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<LexofficeContactListResponse>;
}

/**
 * Pulls all customer contacts from Lexoffice and upserts them into the local `clients` table.
 * Uses `lexoffice_id` as the upsert key.
 */
export async function syncLexofficeContactsToClients(): Promise<LexofficeSyncResult> {
  const apiKey = getLexofficeApiKey();
  const supabase = serviceSupabase();
  if (!supabase) {
    throw new Error("Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY.");
  }

  const contacts: LexofficeApiContact[] = [];
  let page = 0;
  let isLast = false;

  while (!isLast) {
    const data = await fetchLexofficeContactsPage(apiKey, page);
    const content = data.content ?? [];
    contacts.push(...content);
    isLast = data.last ?? true;
    page += 1;
    if (page > 100) break;
  }

  const errors: string[] = [];
  let synced = 0;

  for (const contact of contacts) {
    const id = contact.id?.trim();
    if (!id) {
      continue;
    }

    const companyName =
      contact.company?.name?.trim() ||
      [contact.person?.firstName?.trim(), contact.person?.lastName?.trim()].filter(Boolean).join(" ");

    if (!companyName) {
      continue;
    }

    const email = extractEmailFromContact(contact);
    const phone = extractPhoneFromContact(contact);
    const contactPersons = extractContactPersons(contact);

    const billingAddr = contact.addresses?.billing?.[0];
    const billingAddress = billingAddr
      ? [
          billingAddr.street?.trim(),
          [billingAddr.zip?.trim(), billingAddr.city?.trim()].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ")
      : "";

    const { error } = await supabase.from("clients").upsert(
      {
        company_name: companyName,
        lexoffice_id: id,
        lexoffice_contact_id: id,
        email: email || null,
        phone: phone || null,
        billing_address: billingAddress || null,
        contact_persons: contactPersons,
      },
      { onConflict: "lexoffice_id" }
    );

    if (error) {
      errors.push(`${companyName} (${id}): ${error.message}`);
    } else {
      synced += 1;
    }
  }

  return { synced, errors };
}

/**
 * Creates or updates a Lexoffice contact for a CRM client.
 * If `lexofficeId` is provided, performs a PUT (update); otherwise POST (create).
 */
export async function pushClientToLexoffice(params: {
  lexofficeId?: string | null;
  companyName: string;
  email?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  contactPersons?: ContactPerson[];
}): Promise<LexofficePushResult> {
  let apiKey: string;
  try {
    apiKey = getLexofficeApiKey();
  } catch {
    return { ok: false, error: "LEXOFFICE_API_KEY is not configured." };
  }

  const authHeader = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  const persons = (params.contactPersons ?? []).map((cp, i) => {
    const nameParts = cp.name.trim().split(/\s+/);
    return {
      salutation: "",
      firstName: nameParts[0] ?? "",
      lastName: nameParts.slice(1).join(" ") || "",
      ...(cp.email ? { emailAddress: cp.email } : {}),
      ...(cp.phone ? { phoneNumber: cp.phone } : {}),
      primary: i === 0,
    };
  });

  const contactBody: Record<string, unknown> = {
    version: 0,
    roles: { customer: {} },
    company: { name: params.companyName, contactPersons: persons },
    ...(params.email ? { emailAddresses: { business: [params.email] } } : {}),
    ...(params.phone ? { phoneNumbers: { business: [params.phone] } } : {}),
  };

  try {
    if (params.lexofficeId) {
      const getResp = await fetch(`${LEXOFFICE_API_BASE_URL}/contacts/${params.lexofficeId}`, {
        headers: authHeader,
      });
      if (getResp.ok) {
        const existing = (await getResp.json()) as { version?: number };
        contactBody.id = params.lexofficeId;
        contactBody.version = existing.version ?? 0;
      }

      const putResp = await fetch(`${LEXOFFICE_API_BASE_URL}/contacts/${params.lexofficeId}`, {
        method: "PUT",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(contactBody),
      });

      if (!putResp.ok) {
        const body = await putResp.text().catch(() => "");
        return { ok: false, error: `Lexoffice update failed (${putResp.status}): ${body}` };
      }
      return { ok: true, lexofficeId: params.lexofficeId };
    }

    const postResp = await fetch(`${LEXOFFICE_API_BASE_URL}/contacts`, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(contactBody),
    });

    if (!postResp.ok) {
      const body = await postResp.text().catch(() => "");
      return { ok: false, error: `Lexoffice create failed (${postResp.status}): ${body}` };
    }

    const data = (await postResp.json()) as { id?: string };
    if (!data.id) {
      return { ok: false, error: "Lexoffice did not return a contact ID." };
    }
    return { ok: true, lexofficeId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
