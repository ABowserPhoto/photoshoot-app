import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { buildCompanyLtvMap, normalizeCompanyKey } from "@/lib/crmClientLtv";
import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";

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
};

export type CrmClientRecord = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  billingAddress: string;
  lexofficeId: string;
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
    lifetimeRevenue: companyKey ? (ltvByCompany.get(companyKey) ?? 0) : 0,
  };
}

export async function GET() {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
        "company_name, client, expected_revenue, is_paid, status, services, products, discount, tax_percentage, amount_type"
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
};

export async function POST(request: Request) {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  const payload = {
    company_name: companyName,
    contact_name: typeof body.contact_name === "string" ? body.contact_name.trim() || null : null,
    email: typeof body.email === "string" ? body.email.trim() || null : null,
    phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
    billing_address: typeof body.billing_address === "string" ? body.billing_address.trim() || null : null,
    lexoffice_id: lexofficeId,
    lexoffice_contact_id: lexofficeId,
  };

  const clientId = typeof body.id === "string" ? body.id.trim() : "";

  if (clientId) {
    const { data, error } = await supabase.from("clients").update(payload).eq("id", clientId).select("*").single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: tasks } = await supabase
      .from("tasks")
      .select(
        "company_name, client, expected_revenue, is_paid, status, services, products, discount, tax_percentage, amount_type"
      );
    const ltvByCompany = buildCompanyLtvMap((tasks ?? []) as Record<string, unknown>[]);
    return NextResponse.json({ ok: true, client: mapClientRow(data as ClientRow, ltvByCompany) });
  }

  const { data, error } = await supabase.from("clients").insert(payload).select("*").single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "company_name, client, expected_revenue, is_paid, status, services, products, discount, tax_percentage, amount_type"
    );
  const ltvByCompany = buildCompanyLtvMap((tasks ?? []) as Record<string, unknown>[]);
  return NextResponse.json({ ok: true, client: mapClientRow(data as ClientRow, ltvByCompany) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
