import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

/** Server-only task insert: Supabase only (no local filesystem). New tasks start as awaiting_folder_creation. */
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

  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...insertRow, bracket_size })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ id: data?.id });
}
