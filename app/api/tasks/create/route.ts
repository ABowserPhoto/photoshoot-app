import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { attachClientIdToTaskPayload } from "@/lib/resolveTaskClientId";

export const dynamic = "force-dynamic";

/** Server-only task insert: Supabase only (no local filesystem). New tasks start as awaiting_folder_creation. */
export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      {
        error:
          "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
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

  const bracketRaw = body.bracket_size;
  const bracketSize =
    typeof bracketRaw === "number" && Number.isFinite(bracketRaw)
      ? bracketRaw
      : typeof bracketRaw === "string"
        ? Number(bracketRaw)
        : 3;
  const bracket_size = Number.isFinite(bracketSize) && bracketSize >= 1 && bracketSize <= 15 ? bracketSize : 3;

  const insertRow = { ...body };
  delete insertRow.bracket_size;
  delete insertRow.id;

  insertRow.status = "awaiting_folder_creation";
  insertRow.preview_preference =
    insertRow.preview_preference === "middle" || insertRow.preview_preference === "last"
      ? insertRow.preview_preference
      : "first";
  const skipInvoiceRaw = insertRow.skip_invoice;
  insertRow.skip_invoice =
    typeof skipInvoiceRaw === "boolean"
      ? skipInvoiceRaw
      : typeof skipInvoiceRaw === "string"
        ? ["1", "true", "yes", "on"].includes(skipInvoiceRaw.trim().toLowerCase())
        : false;

  const generateGalleryRaw = insertRow.generate_gallery;
  insertRow.generate_gallery =
    typeof generateGalleryRaw === "boolean"
      ? generateGalleryRaw
      : typeof generateGalleryRaw === "string"
        ? ["1", "true", "yes", "on"].includes(generateGalleryRaw.trim().toLowerCase())
        : true;

  const creditNoteRaw = insertRow.is_credit_note;
  insertRow.is_credit_note =
    typeof creditNoteRaw === "boolean"
      ? creditNoteRaw
      : typeof creditNoteRaw === "string"
        ? ["1", "true", "yes", "on"].includes(creditNoteRaw.trim().toLowerCase())
        : false;

  const expectedRevenueRaw = insertRow.expected_revenue;
  const parsedExpectedRevenue = Number(expectedRevenueRaw);
  insertRow.expected_revenue =
    insertRow.is_credit_note && Number.isFinite(parsedExpectedRevenue) ? parsedExpectedRevenue : 0;

  const isPaidRaw = insertRow.is_paid;
  insertRow.is_paid =
    typeof isPaidRaw === "boolean"
      ? isPaidRaw
      : typeof isPaidRaw === "string"
        ? ["1", "true", "yes", "on"].includes(isPaidRaw.trim().toLowerCase())
        : false;

  // Auth already checked; service_role bypasses RLS for this trusted admin route.
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  let payloadWithClient: Record<string, unknown>;
  try {
    payloadWithClient = await attachClientIdToTaskPayload({ ...insertRow, bracket_size });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve CRM client." },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert(payloadWithClient)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data?.id });
}
