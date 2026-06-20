import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeCompanyKey } from "@/lib/crmClientLtv";
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
    [trimString(input.zip_code), trimString(input.city)].filter(Boolean).join(" "),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildClientInsertPayload(companyName: string, input: TaskClientLinkInput) {
  const lexofficeId = trimString(input.lexoffice_contact_id) || null;
  return {
    company_name: companyName,
    contact_name: composeContactName(input),
    email: trimString(input.email) || null,
    phone: trimString(input.phone) || null,
    street: trimString(input.street) || null,
    zip_code: trimString(input.zip_code) || null,
    city: trimString(input.city) || null,
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
 * Returns null when no company/client label is available on the task.
 */
export async function resolveOrCreateClientIdForTask(input: TaskClientLinkInput): Promise<string | null> {
  const companyName = resolveTaskCompanyName(input);
  if (!companyName) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY.");
  }

  const existing = await findClientByCompanyName(supabase, companyName);
  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from("clients")
    .insert(buildClientInsertPayload(companyName, input))
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return typeof data?.id === "string" ? data.id : null;
}

export async function attachClientIdToTaskPayload(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const clientId = await resolveOrCreateClientIdForTask({
    company_name: trimString(payload.company_name) || null,
    client: trimString(payload.client) || null,
    contact_first_name: trimString(payload.contact_first_name) || null,
    contact_last_name: trimString(payload.contact_last_name) || null,
    email: trimString(payload.email) || null,
    phone: trimString(payload.phone) || null,
    street: trimString(payload.street) || null,
    zip_code: trimString(payload.zip_code) || null,
    city: trimString(payload.city) || null,
    lexoffice_contact_id: trimString(payload.lexoffice_contact_id) || null,
  });

  if (!clientId) {
    return payload;
  }

  return { ...payload, client_id: clientId };
}
