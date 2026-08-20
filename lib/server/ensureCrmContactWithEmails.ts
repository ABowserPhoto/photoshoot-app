import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EnsureCrmContactInput = {
  companyId: string;
  contactId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  emailCc?: string | null;
};

type ContactEmailRow = {
  id?: string;
  email?: string | null;
  is_primary?: boolean | null;
  is_cc?: boolean | null;
};

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function parseEmailList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of value.split(/[,;]+/)) {
    const email = part.trim();
    if (!email || !email.includes("@")) {
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    emails.push(email);
  }
  return emails;
}

function emailKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Inserts or reuses a `contacts` row for the booking person, then writes
 * primary + CC addresses into `contact_emails` using that contact id.
 */
export async function ensureCrmContactWithEmails(
  supabase: SupabaseClient,
  input: EnsureCrmContactInput
): Promise<string | null> {
  const companyId = trimString(input.companyId);
  const firstName = trimString(input.firstName);
  const lastName = trimString(input.lastName);
  const phone = trimString(input.phone) || null;
  const requestedId = trimString(input.contactId);
  const primaryEmails = parseEmailList(input.email);
  const ccEmails = parseEmailList(input.emailCc).filter(
    (email) => !primaryEmails.some((primary) => emailKey(primary) === emailKey(email))
  );

  if (!companyId) {
    return requestedId && isUuid(requestedId) ? requestedId : null;
  }

  if (!firstName && !lastName && !(requestedId && isUuid(requestedId))) {
    return null;
  }

  let contactId = requestedId && isUuid(requestedId) ? requestedId : "";

  if (contactId) {
    const { data: existingById, error: existingByIdError } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .maybeSingle();
    if (existingByIdError) {
      throw new Error(`contacts lookup: ${existingByIdError.message}`);
    }
    if (!existingById?.id) {
      contactId = "";
    } else {
      const { error: updateError } = await supabase
        .from("contacts")
        .update({
          ...(firstName || lastName ? { first_name: firstName, last_name: lastName } : {}),
          phone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", contactId);
      if (updateError) {
        throw new Error(`contacts update: ${updateError.message}`);
      }
    }
  }

  if (!contactId) {
    const { data: companyContacts, error: companyContactsError } = await supabase
      .from("contacts")
      .select("id, first_name, last_name")
      .eq("company_id", companyId);
    if (companyContactsError) {
      throw new Error(`contacts load: ${companyContactsError.message}`);
    }

    const match = (companyContacts ?? []).find((row) => {
      const rowFirst = typeof row.first_name === "string" ? normalizeName(row.first_name) : "";
      const rowLast = typeof row.last_name === "string" ? normalizeName(row.last_name) : "";
      return rowFirst === normalizeName(firstName) && rowLast === normalizeName(lastName);
    });

    if (typeof match?.id === "string" && match.id) {
      contactId = match.id;
      const { error: updateError } = await supabase
        .from("contacts")
        .update({
          phone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", contactId);
      if (updateError) {
        throw new Error(`contacts update: ${updateError.message}`);
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("contacts")
        .insert({
          company_id: companyId,
          first_name: firstName,
          last_name: lastName,
          phone,
        })
        .select("id")
        .maybeSingle();
      if (insertError) {
        throw new Error(`contacts insert: ${insertError.message}`);
      }
      contactId = typeof inserted?.id === "string" ? inserted.id : "";
      if (!contactId) {
        throw new Error("contacts insert: no id returned");
      }
    }
  }

  await upsertContactEmails(supabase, contactId, primaryEmails, ccEmails);
  return contactId;
}

async function upsertContactEmails(
  supabase: SupabaseClient,
  contactId: string,
  primaryEmails: string[],
  ccEmails: string[]
): Promise<void> {
  const emailsToWrite = [
    ...primaryEmails.map((email) => ({ email, isPrimary: true, isCc: false })),
    ...ccEmails.map((email) => ({ email, isPrimary: false, isCc: true })),
  ];
  if (emailsToWrite.length === 0) {
    return;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("contact_emails")
    .select("id, email, is_primary, is_cc")
    .eq("contact_id", contactId);
  if (existingError) {
    throw new Error(`contact_emails load: ${existingError.message}`);
  }

  const existing = (existingRows ?? []) as ContactEmailRow[];
  const existingKeys = new Set(
    existing
      .map((row) => (typeof row.email === "string" ? emailKey(row.email) : ""))
      .filter(Boolean)
  );
  let hasPrimary = existing.some((row) => Boolean(row.is_primary) && !row.is_cc);

  for (const entry of emailsToWrite) {
    const key = emailKey(entry.email);
    if (existingKeys.has(key)) {
      continue;
    }

    const isPrimary = entry.isPrimary && !hasPrimary;
    const { error: insertEmailError } = await supabase.from("contact_emails").insert({
      contact_id: contactId,
      email: entry.email,
      is_primary: isPrimary,
      is_cc: entry.isCc,
    });
    if (insertEmailError && !/duplicate|unique/i.test(insertEmailError.message ?? "")) {
      throw new Error(`contact_emails insert: ${insertEmailError.message}`);
    }

    existingKeys.add(key);
    if (isPrimary) {
      hasPrimary = true;
    }
  }
}
