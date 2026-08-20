import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { buildCompanyLtvMap, normalizeCompanyKey } from "@/lib/crmClientLtv";
import { assertModuleAccess } from "@/lib/server/assertModuleAccess";
import { pushClientToLexoffice, type ContactPerson } from "@/lib/server/lexofficeContacts";

export const dynamic = "force-dynamic";

type ClientRow = {
  id: string;
  company_name: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  billing_address?: string | null;
  lexoffice_id?: string | null;
  street?: string | null;
  zip_code?: string | null;
  city?: string | null;
  lexoffice_contact_id?: string | null;
  contact_persons?: ContactPerson[] | null;
};

export type CrmClientRecord = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  billingAddress: string;
  lexofficeId: string;
  contactPersons: ContactPerson[];
  lifetimeRevenue: number;
};

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function composeBillingAddress(row: ClientRow): string {
  const explicit = row.billing_address?.trim();
  if (explicit) {
    return explicit;
  }
  const parts = [row.street?.trim(), [row.zip_code?.trim(), row.city?.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return parts;
}

function safeContactPersons(value: unknown): ContactPerson[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as Record<string, unknown>;
      return {
        id: typeof row.id === "string" ? row.id : String(Math.random()),
        name: typeof row.name === "string" ? row.name : "",
        email: typeof row.email === "string" ? row.email : "",
        phone: typeof row.phone === "string" ? row.phone : "",
        role: typeof row.role === "string" ? row.role : "",
      };
    })
    .filter((item): item is ContactPerson => item !== null && item.name.trim() !== "");
}

function mapClientRow(row: ClientRow, ltvByCompany: Map<string, number>): CrmClientRecord {
  const companyName = row.company_name?.trim() ?? "";
  const companyKey = normalizeCompanyKey(companyName);
  return {
    id: row.id,
    companyName,
    contactName: row.contact_name?.trim() ?? "",
    email: row.email?.trim() ?? "",
    phone: row.phone?.trim() ?? "",
    billingAddress: composeBillingAddress(row),
    lexofficeId: row.lexoffice_id?.trim() || row.lexoffice_contact_id?.trim() || "",
    contactPersons: safeContactPersons(row.contact_persons),
    lifetimeRevenue: companyKey ? (ltvByCompany.get(companyKey) ?? 0) : 0,
  };
}

export async function GET() {
  const access = await assertModuleAccess("crm");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const [clientsRes, tasksRes] = await Promise.all([
    supabase.from("clients").select("*").order("company_name", { ascending: true }),
    supabase
      .from("tasks")
      .select(
        "company_name, client, expected_revenue, is_paid, credit_note_paid, is_credit_note, status, services, products, discount, tax_percentage, amount_type"
      ),
  ]);

  if (clientsRes.error) {
    return NextResponse.json({ error: clientsRes.error.message }, { status: 400 });
  }
  if (tasksRes.error) {
    return NextResponse.json({ error: tasksRes.error.message }, { status: 400 });
  }

  const ltvByCompany = buildCompanyLtvMap((tasksRes.data ?? []) as Record<string, unknown>[]);
  const clients = ((clientsRes.data ?? []) as ClientRow[])
    .map((row) => mapClientRow(row, ltvByCompany))
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "en"));

  return NextResponse.json({ ok: true, clients });
}

type ClientUpsertBody = {
  id?: unknown;
  company_name?: unknown;
  contact_name?: unknown;
  email?: unknown;
  phone?: unknown;
  billing_address?: unknown;
  lexoffice_id?: unknown;
  contact_persons?: unknown;
};

export async function POST(request: Request) {
  const access = await assertModuleAccess("crm");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: ClientUpsertBody;
  try {
    body = (await request.json()) as ClientUpsertBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const companyName = typeof body.company_name === "string" ? body.company_name.trim() : "";
  if (!companyName) {
    return NextResponse.json({ error: "company_name is required." }, { status: 400 });
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const lexofficeId = typeof body.lexoffice_id === "string" ? body.lexoffice_id.trim() || null : null;
  const contactPersons = safeContactPersons(body.contact_persons);

  const payload = {
    company_name: companyName,
    contact_name: typeof body.contact_name === "string" ? body.contact_name.trim() || null : null,
    email: typeof body.email === "string" ? body.email.trim() || null : null,
    phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
    billing_address: typeof body.billing_address === "string" ? body.billing_address.trim() || null : null,
    lexoffice_id: lexofficeId,
    lexoffice_contact_id: lexofficeId,
    contact_persons: contactPersons,
  };

  const clientId = typeof body.id === "string" ? body.id.trim() : "";

  // Push to Lexoffice (best-effort — DB write is not blocked by Lexoffice failure)
  const lexofficePushPromise = pushClientToLexoffice({
    lexofficeId,
    companyName,
    email: payload.email,
    phone: payload.phone,
    billingAddress: payload.billing_address,
    contactPersons,
  }).then((result) => {
    if (!result.ok) {
      console.warn("[crm/clients] Lexoffice push failed:", result.error);
    } else if (!lexofficeId) {
      // If a new Lexoffice contact was created, write its ID back to the DB record
      return result.lexofficeId;
    }
    return null;
  }).catch((err: unknown) => {
    console.warn("[crm/clients] Lexoffice push error:", err instanceof Error ? err.message : err);
    return null;
  });

  if (clientId) {
    const { data, error } = await supabase.from("clients").update(payload).eq("id", clientId).select("*").single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // If Lexoffice created a new contact (no prior ID), persist the ID
    const newLexId = await lexofficePushPromise;
    if (newLexId) {
      await supabase
        .from("clients")
        .update({ lexoffice_id: newLexId, lexoffice_contact_id: newLexId })
        .eq("id", clientId);
    }

    const { data: tasks } = await supabase
      .from("tasks")
      .select(
        "company_name, client, expected_revenue, is_paid, credit_note_paid, is_credit_note, status, services, products, discount, tax_percentage, amount_type"
      );
    const ltvByCompany = buildCompanyLtvMap((tasks ?? []) as Record<string, unknown>[]);
    return NextResponse.json({ ok: true, client: mapClientRow(data as ClientRow, ltvByCompany) });
  }

  const { data, error } = await supabase.from("clients").insert(payload).select("*").single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const insertedId = (data as { id: string }).id;
  const newLexId = await lexofficePushPromise;
  if (newLexId) {
    await supabase
      .from("clients")
      .update({ lexoffice_id: newLexId, lexoffice_contact_id: newLexId })
      .eq("id", insertedId);
  }

  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "company_name, client, expected_revenue, is_paid, credit_note_paid, is_credit_note, status, services, products, discount, tax_percentage, amount_type"
    );
  const ltvByCompany = buildCompanyLtvMap((tasks ?? []) as Record<string, unknown>[]);
  return NextResponse.json({ ok: true, client: mapClientRow(data as ClientRow, ltvByCompany) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const access = await assertModuleAccess("crm");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const supabase = serviceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
