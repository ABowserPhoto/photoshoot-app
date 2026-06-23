import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  createInvoiceReminderDraftForLexofficeInvoice,
  createInvoiceReminderDraftForTask,
  type ReminderTaskRow,
} from "@/lib/invoiceReminderWorkflow";
import { getAuthRole } from "@/lib/server/getAuthRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

type GenerateReminderBody = {
  type?: unknown;
  taskId?: unknown;
  lexofficeInvoiceId?: unknown;
};

export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: GenerateReminderBody;
  try {
    body = (await request.json()) as GenerateReminderBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const type = typeof body.type === "string" ? body.type.trim() : "";
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const lexofficeInvoiceId = typeof body.lexofficeInvoiceId === "string" ? body.lexofficeInvoiceId.trim() : "";

  const supabase = serviceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 }
    );
  }

  if (type === "lexoffice" || lexofficeInvoiceId) {
    const invoiceId = lexofficeInvoiceId;
    if (!invoiceId) {
      return NextResponse.json({ error: "lexofficeInvoiceId is required." }, { status: 400 });
    }

    let linkedTask: ReminderTaskRow | null = null;
    if (taskId) {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id, title, company_name, contact_first_name, contact_last_name, email, photoshoot_type, shoot_location, lexoffice_invoice_id, lexoffice_document_file_id, invoice_date, is_paid, skip_invoice, expected_revenue, is_credit_note"
        )
        .eq("id", taskId)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      linkedTask = (data as ReminderTaskRow | null) ?? null;
    } else {
      const { data } = await supabase
        .from("tasks")
        .select(
          "id, title, company_name, contact_first_name, contact_last_name, email, photoshoot_type, shoot_location, lexoffice_invoice_id, lexoffice_document_file_id, invoice_date, is_paid, skip_invoice, expected_revenue, is_credit_note"
        )
        .eq("lexoffice_invoice_id", invoiceId)
        .maybeSingle();
      linkedTask = (data as ReminderTaskRow | null) ?? null;
    }

    if (linkedTask?.is_paid) {
      return NextResponse.json({ error: "Linked task is already marked as paid." }, { status: 409 });
    }

    const result = await createInvoiceReminderDraftForLexofficeInvoice(supabase, invoiceId, linkedTask, {
      skipOverdueCheck: true,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
    }

    if (result.markedPaid) {
      if (linkedTask) {
        await supabase
          .from("tasks")
          .update({
            is_paid: true,
            invoice_paid: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", linkedTask.id);
      }
      return NextResponse.json({
        ok: true,
        markedPaid: true,
        message: "Invoice is already paid in Lexoffice.",
      });
    }

    return NextResponse.json({
      ok: true,
      gmailDraftId: result.gmailDraftId,
      invoiceNumber: result.invoiceNumber,
      message: "HTML Draft created in Gmail!",
    });
  }

  const resolvedTaskId = taskId;
  if (!resolvedTaskId) {
    return NextResponse.json({ error: "taskId is required for credit note reminders." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, company_name, contact_first_name, contact_last_name, email, photoshoot_type, shoot_location, lexoffice_invoice_id, lexoffice_document_file_id, invoice_date, is_paid, skip_invoice, expected_revenue, is_credit_note"
    )
    .eq("id", resolvedTaskId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const task = data as ReminderTaskRow;
  if (task.is_paid) {
    return NextResponse.json({ error: "Task is already marked as paid." }, { status: 409 });
  }

  const result = await createInvoiceReminderDraftForTask(supabase, task, { skipOverdueCheck: true });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
  }

  if (result.markedPaid) {
    return NextResponse.json({
      ok: true,
      markedPaid: true,
      message: "Invoice is already paid in Lexoffice — task marked as paid.",
    });
  }

  return NextResponse.json({
    ok: true,
    gmailDraftId: result.gmailDraftId,
    invoiceNumber: result.invoiceNumber,
    message: "HTML Draft created in Gmail!",
  });
}
