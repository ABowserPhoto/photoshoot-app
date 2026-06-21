import { NextResponse } from "next/server";

import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";
import { syncLexofficeContactsToClients } from "@/lib/server/lexofficeContacts";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/crm/lexoffice-sync
 * Pulls all customer contacts from Lexoffice and upserts them into the local clients table.
 * Admin-only endpoint.
 */
export async function POST() {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await syncLexofficeContactsToClients();
    return NextResponse.json({
      ok: true,
      synced: result.synced,
      errors: result.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
