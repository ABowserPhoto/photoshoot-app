import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeReminderDates } from "@/lib/crmReminderDates";

export async function resolveCrmContactIdForReminder(
  supabase: SupabaseClient,
  options: { contactId?: string | null; email?: string | null }
): Promise<string | null> {
  const directId = options.contactId?.trim() ?? "";
  if (directId) {
    return directId;
  }

  const email = options.email?.trim() ?? "";
  if (!email) {
    return null;
  }

  const emailVariants = [...new Set([email, email.toLowerCase()])];
  const { data, error } = await supabase
    .from("contact_emails")
    .select("contact_id, email")
    .in("email", emailVariants)
    .limit(5);

  if (error) {
    console.error("[contact-reminder-dates] email lookup failed:", error.message);
    return null;
  }

  const needle = email.toLowerCase();
  const match = (data ?? []).find((row) => {
    const rowEmail = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    return rowEmail === needle && typeof row.contact_id === "string" && row.contact_id.trim();
  });

  if (match && typeof match.contact_id === "string") {
    return match.contact_id;
  }

  const fallback = data?.find((row) => typeof row.contact_id === "string" && row.contact_id.trim());
  return typeof fallback?.contact_id === "string" ? fallback.contact_id : null;
}

export async function appendContactReminderDate(
  supabase: SupabaseClient,
  contactId: string | null | undefined
): Promise<string[]> {
  const id = contactId?.trim() ?? "";
  if (!id) {
    return [];
  }

  const { data: existing, error: readError } = await supabase
    .from("contacts")
    .select("reminder_dates")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    console.error("[contact-reminder-dates] failed to read reminder_dates:", readError.message);
    return [];
  }

  const now = new Date().toISOString();
  const next = [...normalizeReminderDates(existing?.reminder_dates), now];

  const { data: updated, error: updateError } = await supabase
    .from("contacts")
    .update({
      reminder_dates: next,
      updated_at: now,
    })
    .eq("id", id)
    .select("reminder_dates")
    .maybeSingle();

  if (updateError) {
    console.error("[contact-reminder-dates] failed to append reminder_dates:", updateError.message);
    return next;
  }

  return normalizeReminderDates(updated?.reminder_dates ?? next);
}

export async function recordContactReminderDraft(
  supabase: SupabaseClient,
  options: { contactId?: string | null; email?: string | null }
): Promise<{ crmContactId: string | null; reminderDates: string[] }> {
  try {
    const crmContactId = await resolveCrmContactIdForReminder(supabase, options);
    const reminderDates = await appendContactReminderDate(supabase, crmContactId);
    return { crmContactId, reminderDates };
  } catch (error) {
    console.error("[contact-reminder-dates] failed to record draft timestamp:", error);
    return {
      crmContactId: options.contactId?.trim() || null,
      reminderDates: [],
    };
  }
}

type BillingReminderLookupItem = {
  crmContactId: string | null;
  clientEmail: string | null;
};

export async function loadReminderDatesForBillingItems<T extends BillingReminderLookupItem>(
  supabase: SupabaseClient,
  items: T[]
): Promise<Array<T & { crmContactId: string | null; reminderDates: string[] }>> {
  if (items.length === 0) {
    return [];
  }

  const datesByContactId = new Map<string, string[]>();
  const contactIdByEmail = new Map<string, string>();

  const contactIds = [
    ...new Set(items.map((item) => item.crmContactId?.trim() ?? "").filter(Boolean)),
  ];

  if (contactIds.length > 0) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, reminder_dates")
      .in("id", contactIds);

    if (error) {
      console.error("[contact-reminder-dates] billing contact lookup failed:", error.message);
    } else {
      for (const row of data ?? []) {
        if (typeof row.id === "string" && row.id.trim()) {
          datesByContactId.set(row.id, normalizeReminderDates(row.reminder_dates));
        }
      }
    }
  }

  const emailsNeedingLookup = [
    ...new Set(
      items
        .filter((item) => !item.crmContactId?.trim() && item.clientEmail?.trim())
        .map((item) => item.clientEmail!.trim())
    ),
  ];
  const emailVariants = [...new Set(emailsNeedingLookup.flatMap((email) => [email, email.toLowerCase()]))];

  if (emailVariants.length > 0) {
    const { data, error } = await supabase
      .from("contact_emails")
      .select("contact_id, email")
      .in("email", emailVariants);

    if (error) {
      console.error("[contact-reminder-dates] billing email lookup failed:", error.message);
    } else {
      const unresolvedContactIds: string[] = [];
      for (const row of data ?? []) {
        const contactId = typeof row.contact_id === "string" ? row.contact_id.trim() : "";
        const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
        if (!contactId || !email) {
          continue;
        }
        contactIdByEmail.set(email, contactId);
        if (!datesByContactId.has(contactId)) {
          unresolvedContactIds.push(contactId);
        }
      }

      const uniqueUnresolved = [...new Set(unresolvedContactIds)];
      if (uniqueUnresolved.length > 0) {
        const { data: extraContacts, error: extraError } = await supabase
          .from("contacts")
          .select("id, reminder_dates")
          .in("id", uniqueUnresolved);

        if (extraError) {
          console.error("[contact-reminder-dates] billing follow-up lookup failed:", extraError.message);
        } else {
          for (const row of extraContacts ?? []) {
            if (typeof row.id === "string" && row.id.trim()) {
              datesByContactId.set(row.id, normalizeReminderDates(row.reminder_dates));
            }
          }
        }
      }
    }
  }

  return items.map((item) => {
    const emailKey = item.clientEmail?.trim().toLowerCase() ?? "";
    const crmContactId = item.crmContactId?.trim() || contactIdByEmail.get(emailKey) || null;
    return {
      ...item,
      crmContactId,
      reminderDates: crmContactId ? (datesByContactId.get(crmContactId) ?? []) : [],
    };
  });
}

export async function loadReminderDatesByCompanyId(
  supabase: SupabaseClient
): Promise<Map<string, string[]>> {
  const byCompany = new Map<string, string[]>();
  const { data, error } = await supabase.from("contacts").select("company_id, reminder_dates");
  if (error) {
    console.error("[contact-reminder-dates] company lookup failed:", error.message);
    return byCompany;
  }

  for (const row of data ?? []) {
    const companyId = typeof row.company_id === "string" ? row.company_id.trim() : "";
    const dates = normalizeReminderDates(row.reminder_dates);
    if (!companyId || dates.length === 0) {
      continue;
    }
    const existing = byCompany.get(companyId) ?? [];
    byCompany.set(companyId, normalizeReminderDates([...existing, ...dates]));
  }

  return byCompany;
}
