import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import { redactTaskRowForRole } from "@/lib/tasksRedact";
import type { TaskRow } from "@/lib/tasksRedact";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      {
        error:
          "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      },
      { status: 503 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, company_name, lexoffice_contact_id, contact_first_name, contact_last_name, email, phone, street, zip_code, city, country, services, products, tax_percentage, amount_type, discount, photoshoot_type, shoot_location, photoshoot_date, due_date, editing_started_at, total_editing_seconds, status, is_archived, local_folder_name, bracket_size, cover_image_url"
    )
    .order("id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const rows = (data ?? []) as TaskRow[];
  const visible = auth.isAdmin
    ? rows
    : rows.map((row) => redactTaskRowForRole(row, auth.role));

  return NextResponse.json({
    data: visible,
    meta: { role: auth.role, isAdmin: auth.isAdmin },
  });
}
