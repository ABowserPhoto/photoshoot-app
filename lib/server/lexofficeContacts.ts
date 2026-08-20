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
  if (contact.company?.contactPersons?.length) {
    return contact.company.contactPersons.map((cp, i) => ({
      id: String(i),
      name: [cp.firstName?.trim(), cp.lastName?.trim()].filter(Boolean).join(" "),
      email: cp.emailAddress?.trim() ?? "",
      phone: cp.phoneNumber?.trim() ?? "",
      role: cp.primary ? "Primary" : "",
    }));
  }

  // Person-type Lexoffice contacts (no company.contactPersons).
  const firstName = contact.person?.firstName?.trim() ?? "";
  const lastName = contact.person?.lastName?.trim() ?? "";
  const name = [firstName, lastName].filter(Boolean).join(" ");
  if (!name) {
    return [];
  }
  return [
    {
      id: "0",
      name,
      email: extractEmailFromContact(contact),
      phone: extractPhoneFromContact(contact),
      role: "Primary",
    },
  ];
}

function splitPersonName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0] ?? "", lastName: "" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? "",
  };
}

/**
 * Upserts Lexoffice contact persons into public.contacts + contact_emails so the
 * Booking Modal Contact Person dropdown (GET /api/crm/contacts) stays populated.
 */
async function syncContactPersonsToCrmTables(
  supabase: NonNullable<ReturnType<typeof serviceSupabase>>,
  companyId: string,
  persons: ContactPerson[]
): Promise<string | null> {
  if (persons.length === 0) {
    return null;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, contact_emails(id, email)")
    .eq("company_id", companyId);

  if (existingError) {
    return `contacts load: ${existingError.message}`;
  }

  const existing = Array.isArray(existingRows) ? existingRows : [];

  for (const person of persons) {
    const { firstName, lastName } = splitPersonName(person.name);
    if (!firstName && !lastName) {
      continue;
    }

    const match = existing.find((row) => {
      const rowFirst = typeof row.first_name === "string" ? row.first_name.trim().toLowerCase() : "";
      const rowLast = typeof row.last_name === "string" ? row.last_name.trim().toLowerCase() : "";
      return rowFirst === firstName.toLowerCase() && rowLast === lastName.toLowerCase();
    });

    let contactId = typeof match?.id === "string" ? match.id : "";

    if (contactId) {
      const { error: updateError } = await supabase
        .from("contacts")
        .update({
          phone: person.phone || null,
          role: person.role || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", contactId);
      if (updateError) {
        return `contacts update: ${updateError.message}`;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("contacts")
        .insert({
          company_id: companyId,
          first_name: firstName,
          last_name: lastName,
          phone: person.phone || null,
          role: person.role || null,
        })
        .select("id")
        .maybeSingle();
      if (insertError) {
        return `contacts insert: ${insertError.message}`;
      }
      contactId = typeof inserted?.id === "string" ? inserted.id : "";
      if (!contactId) {
        return "contacts insert: no id returned";
      }
    }

    const email = person.email.trim().toLowerCase();
    if (!email) {
      continue;
    }

    const existingEmails = Array.isArray(match?.contact_emails) ? match.contact_emails : [];
    const emailExists = existingEmails.some(
      (entry) =>
        typeof (entry as { email?: string }).email === "string" &&
        String((entry as { email: string }).email).trim().toLowerCase() === email
    );
    if (emailExists) {
      continue;
    }

    const { error: insertEmailError } = await supabase.from("contact_emails").insert({
      contact_id: contactId,
      email: person.email.trim(),
      is_primary: true,
      is_cc: false,
    });
    if (
      insertEmailError &&
      !/duplicate|unique/i.test(insertEmailError.message ?? "")
    ) {
      return `contact_emails: ${insertEmailError.message}`;
    }
  }

  return null;
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
  const url = `${LEXOFFICE_API_BASE_URL}/contacts?${params.toString()}`;
  console.info(`[lexoffice] GET contacts page=${page}`);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[lexoffice] network error fetching contacts page=${page}:`, message);
    throw new Error(`Lexoffice contacts fetch network error: ${message}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[lexoffice] contacts page=${page} rejected:`, response.status, body.slice(0, 500));
    throw new Error(`Lexoffice contacts fetch failed (${response.status}): ${body}`);
  }
  const data = (await response.json()) as LexofficeContactListResponse;
  console.info(
    `[lexoffice] contacts page=${page} ok — content=${data.content?.length ?? 0}, totalElements=${data.totalElements ?? "?"}, last=${data.last}`
  );
  return data;
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

  console.info("[lexoffice] sync starting — pulling customer contacts");
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

  console.info(`[lexoffice] sync fetched ${contacts.length} Lexoffice contacts — upserting clients + CRM contacts`);
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

    const { data: upserted, error } = await supabase
      .from("clients")
      .upsert(
        {
          company_name: companyName,
          lexoffice_id: id,
          lexoffice_contact_id: id,
          email: email || null,
          phone: phone || null,
          billing_address: billingAddress || null,
          contact_persons: contactPersons,
          street: billingAddr?.street?.trim() || null,
          zip_code: billingAddr?.zip?.trim() || null,
          city: billingAddr?.city?.trim() || null,
          country: billingAddr?.countryCode?.trim() || null,
        },
        { onConflict: "lexoffice_id" }
      )
      .select("id")
      .maybeSingle();

    if (error) {
      errors.push(`${companyName} (${id}): ${error.message}`);
      continue;
    }

    const companyId = typeof upserted?.id === "string" ? upserted.id : "";
    if (!companyId) {
      // Upsert without RETURNING can happen on some PostgREST configs — resolve by lexoffice_id.
      const { data: found, error: findError } = await supabase
        .from("clients")
        .select("id")
        .eq("lexoffice_id", id)
        .maybeSingle();
      if (findError || !found?.id) {
        errors.push(`${companyName} (${id}): client upserted but id not returned`);
        continue;
      }
      const personError = await syncContactPersonsToCrmTables(supabase, found.id, contactPersons);
      if (personError) {
        errors.push(`${companyName} (${id}): ${personError}`);
      } else {
        synced += 1;
      }
      continue;
    }

    const personError = await syncContactPersonsToCrmTables(supabase, companyId, contactPersons);
    if (personError) {
      errors.push(`${companyName} (${id}): ${personError}`);
    } else {
      synced += 1;
    }
  }

  console.info(`[lexoffice] sync finished — synced=${synced}, errors=${errors.length}`);
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
