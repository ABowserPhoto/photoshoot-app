"use server";

import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import { parseCompanyAddress } from "@/lib/parseCompanyAddress";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

const LEXOFFICE_CONTACTS_URL = "https://api.lexoffice.io/v1/contacts";

export type ApproveClientResult =
  | { ok: true; lexofficeSynced: boolean; lexofficeError: string | null }
  | { ok: false; error: string };

type ClientApprovalRow = {
  id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_name: string | null;
  company_address: string | null;
  billing_address: string | null;
  street: string | null;
  zip_code: string | null;
  city: string | null;
  country: string | null;
  billing_street: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  billing_country: string | null;
  address_supplement: string | null;
  phone_number: string | null;
  phone: string | null;
  email: string | null;
  user_id: string | null;
  lexoffice_id: string | null;
  lexoffice_contact_id: string | null;
};

const CLIENT_COLUMNS =
  "id, company_name, first_name, last_name, contact_first_name, contact_last_name, contact_name, company_address, billing_address, street, zip_code, city, country, billing_street, billing_postal_code, billing_city, billing_country, address_supplement, phone_number, phone, email, user_id, lexoffice_id, lexoffice_contact_id";

function trim(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function countryCodeFrom(value: string): string {
  const normalized = value.trim();
  if (/^[A-Za-z]{2}$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  const named: Record<string, string> = {
    germany: "DE",
    deutschland: "DE",
    austria: "AT",
    österreich: "AT",
    oesterreich: "AT",
    switzerland: "CH",
    schweiz: "CH",
  };
  return named[normalized.toLowerCase()] ?? "";
}

function personName(client: ClientApprovalRow): { firstName: string; lastName: string } {
  const firstName = trim(client.first_name) || trim(client.contact_first_name);
  const lastName = trim(client.last_name) || trim(client.contact_last_name);
  if (firstName || lastName) {
    return { firstName, lastName };
  }

  const parts = trim(client.contact_name).split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: "", lastName: parts[0] ?? "" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? "",
  };
}

function billingAddress(client: ClientApprovalRow) {
  const parsed = parseCompanyAddress(trim(client.company_address) || trim(client.billing_address));
  const street = parsed.street || trim(client.billing_street) || trim(client.street);
  const zip = parsed.zip || trim(client.billing_postal_code) || trim(client.zip_code);
  const city = parsed.city || trim(client.billing_city) || trim(client.city);
  const countryCode =
    parsed.countryCode ||
    countryCodeFrom(trim(client.billing_country) || trim(client.country)) ||
    (street || zip || city ? "DE" : "");
  const supplement = trim(client.address_supplement);

  if (!street && !zip && !city && !supplement) {
    return undefined;
  }

  return {
    ...(supplement ? { supplement } : {}),
    ...(street ? { street } : {}),
    ...(zip ? { zip } : {}),
    ...(city ? { city } : {}),
    countryCode: countryCode || "DE",
  };
}

function buildLexofficeContactBody(client: ClientApprovalRow, email: string, phone: string) {
  const companyName = trim(client.company_name);
  const { firstName, lastName } = personName(client);
  const resolvedLastName = lastName || firstName;
  const address = billingAddress(client);

  const contactPerson =
    firstName || lastName
      ? {
          ...(firstName && lastName ? { firstName } : {}),
          lastName: resolvedLastName,
          ...(email ? { emailAddress: email } : {}),
          ...(phone ? { phoneNumber: phone } : {}),
          primary: true,
        }
      : null;

  const body: Record<string, unknown> = {
    version: 0,
    roles: { customer: {} },
  };

  if (companyName) {
    body.company = {
      name: companyName,
      ...(contactPerson ? { contactPersons: [contactPerson] } : {}),
    };
  } else if (resolvedLastName) {
    body.person = {
      ...(firstName && lastName ? { firstName } : {}),
      lastName: resolvedLastName,
    };
  }

  if (address) {
    body.addresses = { billing: [address] };
  }
  if (email) {
    body.emailAddresses = { business: [email] };
  }
  if (phone) {
    body.phoneNumbers = { business: [phone] };
  }

  return body;
}

async function resolveUserEmail(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  client: ClientApprovalRow
): Promise<string> {
  const onFile = trim(client.email);
  if (onFile) {
    return onFile;
  }
  if (!client.user_id) {
    return "";
  }

  const { data, error } = await supabase.auth.admin.getUserById(client.user_id);
  if (error) {
    console.error("[approveClient] Could not load the linked user's email:", error.message);
    return "";
  }
  return data.user?.email?.trim() ?? "";
}

async function postLexofficeContact(body: Record<string, unknown>): Promise<string> {
  const apiKey = process.env.LEXOFFICE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("LEXOFFICE_API_KEY is not configured.");
  }

  const response = await fetch(LEXOFFICE_CONTACTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Lexoffice contact creation failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { id?: string };
  const lexofficeId = data.id?.trim() ?? "";
  if (!lexofficeId) {
    throw new Error("Lexoffice contact creation succeeded but no contact id was returned.");
  }
  return lexofficeId;
}

export async function approveClient(clientId: string): Promise<ApproveClientResult> {
  const access = await assertModuleAccess("crm");
  if (!access.ok) {
    return { ok: false, error: access.error };
  }

  const id = clientId.trim();
  if (!id) {
    return { ok: false, error: "Client id is required." };
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const { data, error: loadError } = await supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return { ok: false, error: loadError.message };
  }
  if (!data) {
    return { ok: false, error: "Client not found." };
  }

  const client = data as ClientApprovalRow;

  const { error: approvalError } = await supabase
    .from("clients")
    .update({ is_approved: true })
    .eq("id", id);

  if (approvalError) {
    return { ok: false, error: approvalError.message };
  }

  const { data: confirmed, error: confirmError } = await supabase
    .from("clients")
    .select("is_approved")
    .eq("id", id)
    .maybeSingle();

  if (confirmError) {
    return { ok: false, error: confirmError.message };
  }
  if (confirmed?.is_approved !== true) {
    return {
      ok: false,
      error: "Approval was not saved. A staff account is required to approve clients.",
    };
  }

  const existingLexofficeId = trim(client.lexoffice_id) || trim(client.lexoffice_contact_id);
  if (existingLexofficeId) {
    return { ok: true, lexofficeSynced: true, lexofficeError: null };
  }

  try {
    const email = await resolveUserEmail(supabase, client);
    const phone = trim(client.phone_number) || trim(client.phone);
    const lexofficeId = await postLexofficeContact(buildLexofficeContactBody(client, email, phone));

    const { error: linkError } = await supabase
      .from("clients")
      .update({ lexoffice_id: lexofficeId, lexoffice_contact_id: lexofficeId })
      .eq("id", id);

    if (linkError) {
      console.error(
        "[approveClient] Lexoffice contact was created, but storing the id failed:",
        linkError.message
      );
    }

    return { ok: true, lexofficeSynced: true, lexofficeError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lexoffice contact creation failed.";
    console.error("[approveClient] Lexoffice sync failed after approval:", message);
    return { ok: true, lexofficeSynced: false, lexofficeError: message };
  }
}
