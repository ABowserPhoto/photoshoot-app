import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeCompanyKey } from "@/lib/crmClientLtv";
import { ensureCrmContactWithEmails } from "@/lib/server/ensureCrmContactWithEmails";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type TaskClientLinkInput = {
  company_name?: string | null;
  client?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  zip_code?: string | null;
  city?: string | null;
  country?: string | null;
  address_supplement?: string | null;
  lexoffice_contact_id?: string | null;
};

type ClientLookupRow = {
  id: string;
  company_name: string | null;
};

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveTaskCompanyName(input: TaskClientLinkInput): string {
  return trimString(input.company_name) || trimString(input.client);
}

function composeContactName(input: TaskClientLinkInput): string | null {
  const contactName = [trimString(input.contact_first_name), trimString(input.contact_last_name)]
    .filter(Boolean)
    .join(" ");
  return contactName || null;
}

function composeBillingAddress(input: TaskClientLinkInput): string | null {
  const parts = [
    trimString(input.street),
    trimString(input.address_supplement),
    [trimString(input.zip_code), trimString(input.city)].filter(Boolean).join(" "),
    trimString(input.country),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildClientWritePayload(companyName: string, input: TaskClientLinkInput) {
  const lexofficeId = trimString(input.lexoffice_contact_id) || null;
  const street = trimString(input.street) || null;
  const zipCode = trimString(input.zip_code) || null;
  const city = trimString(input.city) || null;
  const country = trimString(input.country) || null;
  const addressSupplement = trimString(input.address_supplement) || null;

  return {
    company_name: companyName,
    contact_name: composeContactName(input),
    email: trimString(input.email) || null,
    phone: trimString(input.phone) || null,
    street,
    zip_code: zipCode,
    city,
    country,
    address_supplement: addressSupplement,
    billing_street: street,
    billing_postal_code: zipCode,
    billing_city: city,
    billing_country: country,
    billing_address: composeBillingAddress(input),
    lexoffice_contact_id: lexofficeId,
    lexoffice_id: lexofficeId,
  };
}

async function findClientByCompanyName(
  supabase: SupabaseClient,
  companyName: string
): Promise<ClientLookupRow | null> {
  const targetKey = normalizeCompanyKey(companyName);
  if (!targetKey) {
    return null;
  }

  const { data, error } = await supabase.from("clients").select("id, company_name");
  if (error) {
    throw new Error(error.message);
  }

  const match = ((data ?? []) as ClientLookupRow[]).find(
    (row) => normalizeCompanyKey(row.company_name) === targetKey
  );
  return match ?? null;
}

/**
 * Finds an existing CRM client by company/client name (case-insensitive) or creates one.
 * When an existing client is found, address/contact fields from the booking are written back
 * onto the `clients` row so Addresszusatz and moves persist for the next booking.
 * Returns null when no company/client label is available on the task.
 */
export async function resolveOrCreateClientIdForTask(
  input: TaskClientLinkInput,
  supabaseClient?: SupabaseClient | null
): Promise<string | null> {
  const companyName = resolveTaskCompanyName(input);
  if (!companyName) {
    return null;
  }

  const supabase = supabaseClient ?? createSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY.");
  }

  const writePayload = buildClientWritePayload(companyName, input);
  const existing = await findClientByCompanyName(supabase, companyName);
  if (existing) {
    const { error: updateError } = await supabase
      .from("clients")
      .update({
        street: writePayload.street,
        zip_code: writePayload.zip_code,
        city: writePayload.city,
        country: writePayload.country,
        address_supplement: writePayload.address_supplement,
        billing_street: writePayload.billing_street,
        billing_postal_code: writePayload.billing_postal_code,
        billing_city: writePayload.billing_city,
        billing_country: writePayload.billing_country,
        billing_address: writePayload.billing_address,
        contact_name: writePayload.contact_name,
        // Prefer booking values when provided; leave existing CRM email/phone if blank on form.
        ...(writePayload.email ? { email: writePayload.email } : {}),
        ...(writePayload.phone ? { phone: writePayload.phone } : {}),
        ...(writePayload.lexoffice_contact_id
          ? {
              lexoffice_contact_id: writePayload.lexoffice_contact_id,
              lexoffice_id: writePayload.lexoffice_id,
            }
          : {}),
      })
      .eq("id", existing.id);
    if (updateError) {
      throw new Error(updateError.message);
    }
    return existing.id;
  }

  const { data, error } = await supabase.from("clients").insert(writePayload).select("id").single();

  if (error) {
    throw new Error(error.message);
  }

  return typeof data?.id === "string" ? data.id : null;
}

export async function attachClientIdToTaskPayload(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY.");
  }

  const linkInput: TaskClientLinkInput = {
    company_name: trimString(payload.company_name) || null,
    client: trimString(payload.client) || null,
    contact_first_name: trimString(payload.contact_first_name) || null,
    contact_last_name: trimString(payload.contact_last_name) || null,
    email: trimString(payload.email) || null,
    phone: trimString(payload.phone) || null,
    street: trimString(payload.street) || null,
    zip_code: trimString(payload.zip_code) || null,
    city: trimString(payload.city) || null,
    country: trimString(payload.country) || null,
    address_supplement: trimString(payload.address_supplement) || null,
    lexoffice_contact_id: trimString(payload.lexoffice_contact_id) || null,
  };

  const clientId = await resolveOrCreateClientIdForTask(linkInput, supabase);
  if (!clientId) {
    return payload;
  }

  const contactId = await ensureCrmContactWithEmails(supabase, {
    companyId: clientId,
    contactId: trimString(payload.contact_id) || null,
    firstName: linkInput.contact_first_name,
    lastName: linkInput.contact_last_name,
    phone: linkInput.phone,
    email: linkInput.email,
    emailCc: trimString(payload.email_cc) || null,
  });

  return {
    ...payload,
    client_id: clientId,
    ...(contactId ? { contact_id: contactId } : {}),
  };
}
