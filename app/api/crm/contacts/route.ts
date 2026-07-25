import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = Number(process.env.TASKS_FETCH_TIMEOUT_MS ?? "8000");

export type CrmContactEmail = {
  id: string;
  email: string;
  isCc: boolean;
  isPrimary: boolean;
};

export type CrmContactRecord = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  role: string;
  companyId: string;
  companyName: string;
  lexofficeContactId: string;
  billingStreet: string;
  billingCity: string;
  billingPostalCode: string;
  billingCountry: string;
  emails: CrmContactEmail[];
  primaryEmail: string;
  ccEmails: string[];
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => fetchWithTimeout(input, init, FETCH_TIMEOUT_MS),
    },
  });
}

/**
 * GET /api/crm/contacts
 * Returns searchable contacts with company billing details and emails.
 */
export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("contacts")
    .select(
      `
      id,
      first_name,
      last_name,
      phone,
      role,
      company_id,
      clients!inner (
        id,
        company_name,
        street,
        city,
        zip_code,
        country,
        billing_street,
        billing_city,
        billing_postal_code,
        billing_country,
        lexoffice_contact_id,
        lexoffice_id
      ),
      contact_emails (
        id,
        email,
        is_cc,
        is_primary
      )
    `
    )
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (error) {
    console.error("[api/crm/contacts]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const contacts: CrmContactRecord[] = (data ?? []).map((row) => {
    const companyRaw = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    const company = (companyRaw ?? {}) as {
      id?: string;
      company_name?: string | null;
      street?: string | null;
      city?: string | null;
      zip_code?: string | null;
      country?: string | null;
      billing_street?: string | null;
      billing_city?: string | null;
      billing_postal_code?: string | null;
      billing_country?: string | null;
      lexoffice_contact_id?: string | null;
      lexoffice_id?: string | null;
    };

    const emails: CrmContactEmail[] = (Array.isArray(row.contact_emails) ? row.contact_emails : [])
      .map((entry) => {
        const e = entry as {
          id?: string;
          email?: string | null;
          is_cc?: boolean | null;
          is_primary?: boolean | null;
        };
        const email = typeof e.email === "string" ? e.email.trim() : "";
        if (!email) return null;
        return {
          id: typeof e.id === "string" ? e.id : "",
          email,
          isCc: Boolean(e.is_cc),
          isPrimary: Boolean(e.is_primary),
        };
      })
      .filter((entry): entry is CrmContactEmail => Boolean(entry));

    const primary =
      emails.find((e) => e.isPrimary && !e.isCc)?.email ||
      emails.find((e) => !e.isCc)?.email ||
      emails[0]?.email ||
      "";
    const ccEmails = emails.filter((e) => e.isCc).map((e) => e.email);

    const firstName = typeof row.first_name === "string" ? row.first_name.trim() : "";
    const lastName = typeof row.last_name === "string" ? row.last_name.trim() : "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || "Contact";

    return {
      id: String(row.id),
      firstName,
      lastName,
      fullName,
      phone: typeof row.phone === "string" ? row.phone.trim() : "",
      role: typeof row.role === "string" ? row.role.trim() : "",
      companyId: typeof company.id === "string" ? company.id : String(row.company_id),
      companyName: typeof company.company_name === "string" ? company.company_name.trim() : "",
      lexofficeContactId:
        (typeof company.lexoffice_contact_id === "string" && company.lexoffice_contact_id.trim()) ||
        (typeof company.lexoffice_id === "string" && company.lexoffice_id.trim()) ||
        "",
      billingStreet: (company.billing_street || company.street || "").trim(),
      billingCity: (company.billing_city || company.city || "").trim(),
      billingPostalCode: (company.billing_postal_code || company.zip_code || "").trim(),
      billingCountry: (company.billing_country || company.country || "").trim(),
      emails,
      primaryEmail: primary,
      ccEmails,
    };
  });

  return NextResponse.json({ ok: true, contacts });
}
