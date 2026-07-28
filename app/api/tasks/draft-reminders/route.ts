import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  createInvoiceReminderDraftForTask,
  type ReminderTaskRow,
} from "@/lib/invoiceReminderWorkflow";
import { getAuthRole } from "@/lib/server/getAuthRole";
import { isTestTaskRow } from "@/lib/testTaskFilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OVERDUE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type TaskResult =
  | { taskId: string; status: "draft_created"; gmailDraftId: string; invoiceNumber: string | null }
  | { taskId: string; status: "marked_paid" }
  | { taskId: string; status: "skipped"; reason: string }
  | { taskId: string; status: "error"; error: string };

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value?.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isInvoiceOverdue(invoiceDate: Date, now = new Date()): boolean {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - OVERDUE_DAYS);
  const invoiceDay = new Date(invoiceDate);
  invoiceDay.setHours(0, 0, 0, 0);
  return invoiceDay.getTime() <= cutoff.getTime();
}

export async function POST() {
  const auth = await getAuthRole();
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

  const cutoffIso = new Date(Date.now() - OVERDUE_DAYS * MS_PER_DAY).toISOString();

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, company_name, contact_first_name, contact_last_name, email, photoshoot_type, shoot_location, photoshoot_date, lexoffice_invoice_id, lexoffice_document_file_id, invoice_date, is_paid, skip_invoice, expected_revenue, is_credit_note"
    )
    .not("lexoffice_invoice_id", "is", null)
    .or("is_paid.is.null,is_paid.eq.false")
    .or("skip_invoice.is.null,skip_invoice.eq.false")
    .or(`invoice_date.lte.${cutoffIso},invoice_date.is.null`);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const candidates = ((data ?? []) as ReminderTaskRow[]).filter((row) => !isTestTaskRow(row as Record<string, unknown>));
  const results: TaskResult[] = [];

  for (const task of candidates) {
    const taskId = task.id;
    const invoiceId = task.lexoffice_invoice_id?.trim() ?? "";

    if (!invoiceId) {
      results.push({ taskId, status: "skipped", reason: "Missing Lexoffice invoice id." });
      continue;
    }

    if (!task.email?.trim()) {
      results.push({ taskId, status: "skipped", reason: "Missing client email." });
      continue;
    }

    const storedInvoiceDate = parseDate(task.invoice_date);
    if (storedInvoiceDate && !isInvoiceOverdue(storedInvoiceDate)) {
      results.push({ taskId, status: "skipped", reason: "Invoice is not yet overdue in Supabase." });
      continue;
    }

    try {
      const result = await createInvoiceReminderDraftForTask(supabase, task);
      if (!result.ok) {
        results.push({ taskId, status: "skipped", reason: result.error });
        continue;
      }
      if (result.markedPaid) {
        results.push({ taskId, status: "marked_paid" });
        continue;
      }
      results.push({
        taskId,
        status: "draft_created",
        gmailDraftId: result.gmailDraftId,
        invoiceNumber: result.invoiceNumber,
      });
    } catch (taskError) {
      const message = taskError instanceof Error ? taskError.message : "Unknown error";
      console.error(`[draft-reminders] Failed for task ${taskId}:`, message);
      results.push({ taskId, status: "error", error: message });
    }
  }

  const summary = {
    scanned: candidates.length,
    draftsCreated: results.filter((entry) => entry.status === "draft_created").length,
    markedPaid: results.filter((entry) => entry.status === "marked_paid").length,
    skipped: results.filter((entry) => entry.status === "skipped").length,
    errors: results.filter((entry) => entry.status === "error").length,
  };

  return NextResponse.json({
    ok: true,
    overdueDays: OVERDUE_DAYS,
    summary,
    results,
  });
}
