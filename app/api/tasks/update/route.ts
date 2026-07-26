import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { attachClientIdToTaskPayload } from "@/lib/resolveTaskClientId";
import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      {
        error:
          "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const taskId = typeof body.id === "string" ? body.id.trim() : "";
  if (!taskId) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const updateRow = { ...body };
  delete updateRow.id;

  const creditNoteRaw = updateRow.is_credit_note;
  if (creditNoteRaw !== undefined) {
    updateRow.is_credit_note =
      typeof creditNoteRaw === "boolean"
        ? creditNoteRaw
        : typeof creditNoteRaw === "string"
          ? ["1", "true", "yes", "on"].includes(creditNoteRaw.trim().toLowerCase())
          : false;
  }

  const expectedRevenueRaw = updateRow.expected_revenue;
  if (expectedRevenueRaw !== undefined) {
    const parsedExpectedRevenue = Number(expectedRevenueRaw);
    updateRow.expected_revenue =
      updateRow.is_credit_note === true && Number.isFinite(parsedExpectedRevenue) ? parsedExpectedRevenue : 0;
  }

  const toBool = (value: unknown, fallback = false) =>
    typeof value === "boolean"
      ? value
      : typeof value === "string"
        ? ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
        : fallback;

  const isPaidRaw = updateRow.is_paid;
  if (isPaidRaw !== undefined) {
    updateRow.is_paid = toBool(isPaidRaw);
  }

  const creditNotePaidRaw = updateRow.credit_note_paid;
  if (creditNotePaidRaw !== undefined) {
    updateRow.credit_note_paid = toBool(creditNotePaidRaw);
  }

  if (updateRow.credit_note_file_url !== undefined) {
    const rawUrl = updateRow.credit_note_file_url;
    updateRow.credit_note_file_url =
      typeof rawUrl === "string" && rawUrl.trim() ? rawUrl.trim() : null;
  }

  const skipInvoiceRaw = updateRow.skip_invoice;
  if (skipInvoiceRaw !== undefined) {
    updateRow.skip_invoice = toBool(skipInvoiceRaw);
  }

  updateRow.updated_at = new Date().toISOString();

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Ignore when cookies are not writable.
        }
      },
    },
  });

  // Credit notes may only be marked paid via processCreditNotePayment (PDF → Lexoffice).
  const wantsCreditNotePaid =
    updateRow.is_credit_note === true &&
    (updateRow.credit_note_paid === true || updateRow.is_paid === true);
  if (wantsCreditNotePaid) {
    const { data: existing, error: existingError } = await supabase
      .from("tasks")
      .select("credit_note_paid, credit_note_file_url")
      .eq("id", taskId)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }
    if (!existing?.credit_note_paid || !existing?.credit_note_file_url) {
      return NextResponse.json(
        {
          error:
            "Upload the credit note PDF to mark this shoot as paid (Credit Note Paid checkbox).",
        },
        { status: 400 }
      );
    }
  }

  let payloadWithClient: Record<string, unknown>;
  try {
    payloadWithClient = await attachClientIdToTaskPayload(updateRow);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve CRM client." },
      { status: 500 }
    );
  }

  const { error } = await supabase.from("tasks").update(payloadWithClient).eq("id", taskId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: taskId });
}
