import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { isCrmEligibleCreditNoteBillingTask } from "@/lib/crmTaskFilters";
import {
  indexTasksByLexofficeInvoiceId,
  mapCreditNoteTaskToUnpaidBillingItem,
  mapLexofficeInvoiceToUnpaidBillingItem,
  mergeAndSortUnpaidBillingItems,
  type UnpaidBillingItem,
} from "@/lib/crmUnpaidBilling";
import type { ReminderTaskRow } from "@/lib/invoiceReminderWorkflow";
import { listLexofficeUnpaidSalesInvoices } from "@/lib/lexoffice";
import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type CreditNoteTaskRow = ReminderTaskRow & {
  client?: string | null;
  photoshoot_date?: string | null;
};

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
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

  const [creditNotesResult, linkedTasksResult] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, title, client, company_name, contact_first_name, contact_last_name, photoshoot_date, expected_revenue, lexoffice_invoice_id, email, is_paid, credit_note_paid, credit_note_file_url, invoice_date, photoshoot_type, shoot_location, lexoffice_document_file_id, skip_invoice, is_credit_note"
      )
      .or("is_paid.is.null,is_paid.eq.false")
      .or("credit_note_paid.is.null,credit_note_paid.eq.false")
      .gt("expected_revenue", 0)
      .order("photoshoot_date", { ascending: true }),
    supabase
      .from("tasks")
      .select(
        "id, title, client, company_name, contact_first_name, contact_last_name, photoshoot_date, expected_revenue, lexoffice_invoice_id, email, is_paid, invoice_date, photoshoot_type, shoot_location, lexoffice_document_file_id, skip_invoice, is_credit_note"
      )
      .not("lexoffice_invoice_id", "is", null),
  ]);

  let lexofficeResult: Awaited<ReturnType<typeof listLexofficeUnpaidSalesInvoices>>;
  try {
    lexofficeResult = await listLexofficeUnpaidSalesInvoices();
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Lexoffice invoices." },
      { status: 502 }
    );
  }

  if (creditNotesResult.error) {
    return NextResponse.json({ error: creditNotesResult.error.message }, { status: 400 });
  }
  if (linkedTasksResult.error) {
    return NextResponse.json({ error: linkedTasksResult.error.message }, { status: 400 });
  }

  const creditNoteTasks = ((creditNotesResult.data ?? []) as CreditNoteTaskRow[]).filter((row) =>
    isCrmEligibleCreditNoteBillingTask(row as Record<string, unknown>)
  );
  const linkedTasks = (linkedTasksResult.data ?? []) as CreditNoteTaskRow[];
  const tasksByInvoiceId = indexTasksByLexofficeInvoiceId(linkedTasks);

  const lexofficeIdSet = new Set(lexofficeResult.map((item) => item.id));

  const lexofficeItems = lexofficeResult
    .map((item) => mapLexofficeInvoiceToUnpaidBillingItem(item, tasksByInvoiceId.get(item.id) ?? null))
    .filter((item): item is UnpaidBillingItem => item !== null);

  const creditNoteItems = creditNoteTasks
    .filter((row) => {
      const invoiceId = row.lexoffice_invoice_id?.trim();
      return !invoiceId || !lexofficeIdSet.has(invoiceId);
    })
    .map((row) => mapCreditNoteTaskToUnpaidBillingItem(row))
    .filter((item): item is UnpaidBillingItem => item !== null);

  const items = mergeAndSortUnpaidBillingItems([...lexofficeItems, ...creditNoteItems]);

  return NextResponse.json({ ok: true, items });
}
