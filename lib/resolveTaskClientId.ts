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

/** Empty / whitespace-only Lexoffice IDs must be null so unique constraints are not hit. */
function sanitizeLexofficeId(value: unknown): string | null {
  const trimmed = trimString(value);
  return trimmed || null;
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
  const lexofficeId = sanitizeLexofficeId(input.lexoffice_contact_id);
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

function isLexofficeIdUniqueViolation(message: string | undefined): boolean {
  const text = message ?? "";
  return /clients_lexoffice_id_key|duplicate key.*lexoffice_id|unique.*lexoffice_id/i.test(text);
}

async function findClientByLexofficeId(
  supabase: SupabaseClient,
  lexofficeId: string
): Promise<ClientLookupRow | null> {
  const id = sanitizeLexofficeId(lexofficeId);
  if (!id) {
    return null;
  }

  const { data, error } = await supabase
    .from("clients")
    .select("id, company_name")
    .eq("lexoffice_id", id)
    .maybeSingle();

  if (error) {
    // Older schemas may only have lexoffice_contact_id.
    if (/lexoffice_id|column|schema|Could not find/i.test(error.message)) {
      const retry = await supabase
        .from("clients")
        .select("id, company_name")
        .eq("lexoffice_contact_id", id)
        .maybeSingle();
      if (retry.error) {
        throw new Error(retry.error.message);
      }
      return (retry.data as ClientLookupRow | null) ?? null;
    }
    throw new Error(error.message);
  }

  return (data as ClientLookupRow | null) ?? null;
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

async function updateClientRow(
  supabase: SupabaseClient,
  clientId: string,
  writePayload: ReturnType<typeof buildClientWritePayload>
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    company_name: writePayload.company_name,
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
    ...(writePayload.email ? { email: writePayload.email } : {}),
    ...(writePayload.phone ? { phone: writePayload.phone } : {}),
  };

  // Only write Lexoffice IDs when non-empty. Never persist "".
  if (writePayload.lexoffice_id) {
    updatePayload.lexoffice_contact_id = writePayload.lexoffice_id;
    updatePayload.lexoffice_id = writePayload.lexoffice_id;
  }

  const { error: updateError } = await supabase.from("clients").update(updatePayload).eq("id", clientId);
  if (updateError) {
    // Another client already owns this lexoffice_id — keep address sync, skip ID overwrite.
    if (isLexofficeIdUniqueViolation(updateError.message) && writePayload.lexoffice_id) {
      const withoutLex = { ...updatePayload };
      delete withoutLex.lexoffice_id;
      delete withoutLex.lexoffice_contact_id;
      const { error: retryError } = await supabase.from("clients").update(withoutLex).eq("id", clientId);
      if (retryError) {
        throw new Error(retryError.message);
      }
      return;
    }
    throw new Error(updateError.message);
  }
}

/**
 * Finds an existing CRM client by Lexoffice ID or company/client name, or creates one.
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

  // Prefer Lexoffice identity when present — avoids clients_lexoffice_id_key on insert.
  let existing: ClientLookupRow | null = null;
  if (writePayload.lexoffice_id) {
    existing = await findClientByLexofficeId(supabase, writePayload.lexoffice_id);
  }
  if (!existing) {
    existing = await findClientByCompanyName(supabase, companyName);
  }

  if (existing) {
    await updateClientRow(supabase, existing.id, writePayload);
    return existing.id;
  }

  if (writePayload.lexoffice_id) {
    const { data: upserted, error: upsertError } = await supabase
      .from("clients")
      .upsert(writePayload, { onConflict: "lexoffice_id" })
      .select("id")
      .maybeSingle();

    if (!upsertError) {
      if (typeof upserted?.id === "string") {
        return upserted.id;
      }
      const byLex = await findClientByLexofficeId(supabase, writePayload.lexoffice_id);
      if (byLex) {
        return byLex.id;
      }
    }

    if (upsertError && isLexofficeIdUniqueViolation(upsertError.message)) {
      const byLex = await findClientByLexofficeId(supabase, writePayload.lexoffice_id);
      if (byLex) {
        await updateClientRow(supabase, byLex.id, writePayload);
        return byLex.id;
      }
    }

    if (upsertError) {
      // Fall through to plain insert without lexoffice_id if upsert unsupported / schema mismatch.
      if (!/onConflict|lexoffice_id|column|schema|Could not find/i.test(upsertError.message)) {
        throw new Error(upsertError.message);
      }
    }
  }

  const insertPayload: Record<string, unknown> = { ...writePayload };
  // Avoid inserting empty-string unique keys; keep null or omit when absent.
  if (!writePayload.lexoffice_id) {
    insertPayload.lexoffice_id = null;
    insertPayload.lexoffice_contact_id = null;
  }

  const { data, error } = await supabase.from("clients").insert(insertPayload).select("id").single();

  if (error) {
    if (isLexofficeIdUniqueViolation(error.message) && writePayload.lexoffice_id) {
      const byLex = await findClientByLexofficeId(supabase, writePayload.lexoffice_id);
      if (byLex) {
        await updateClientRow(supabase, byLex.id, writePayload);
        return byLex.id;
      }
    }
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
    lexoffice_contact_id: sanitizeLexofficeId(payload.lexoffice_contact_id),
  };

  // Also sanitize on the task payload itself so tasks never store "".
  const sanitizedLexofficeContactId = sanitizeLexofficeId(payload.lexoffice_contact_id);

  const clientId = await resolveOrCreateClientIdForTask(linkInput, supabase);
  if (!clientId) {
    return {
      ...payload,
      lexoffice_contact_id: sanitizedLexofficeContactId,
    };
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
    lexoffice_contact_id: sanitizedLexofficeContactId,
    ...(contactId ? { contact_id: contactId } : {}),
  };
}
