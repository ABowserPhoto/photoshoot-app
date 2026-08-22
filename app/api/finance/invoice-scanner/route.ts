import { NextRequest, NextResponse } from "next/server";

import { runGmailInvoiceScanner } from "@/lib/server/gmailInvoiceScanner";
import { assertModuleAccess } from "@/lib/server/assertModuleAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeRequest(request: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const authHeader = request.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
    const querySecret = request.nextUrl.searchParams.get("secret")?.trim() ?? "";
    if (bearerToken === cronSecret || querySecret === cronSecret) {
      return { ok: true };
    }
  }

  return { ok: false, status: 401, error: "Unauthorized" };
}

async function authorizeAdminOrCron(
  request: NextRequest
): Promise<{ ok: true; via: "cron" | "admin" } | { ok: false; status: number; error: string }> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const authHeader = request.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
    const querySecret = request.nextUrl.searchParams.get("secret")?.trim() ?? "";
    if (bearerToken === cronSecret || querySecret === cronSecret) {
      return { ok: true, via: "cron" };
    }
  }

  const access = await assertModuleAccess("crm");
  if (!access.ok) {
    return { ok: false, status: access.status, error: access.error };
  }
  return { ok: true, via: "admin" };
}

/**
 * POST /api/finance/invoice-scanner
 *
 * Scans Gmail (last 7 days) for invoice/receipt messages and uploads documents
 * to Lexoffice Inbox (POST /v1/files, type=voucher).
 *
 * Auth: CRM admin session OR CRON_SECRET (Bearer / ?secret=).
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeAdminOrCron(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!process.env.LEXOFFICE_API_KEY?.trim()) {
    return NextResponse.json({ error: "LEXOFFICE_API_KEY is not configured." }, { status: 503 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for invoice deduplication." },
      { status: 503 }
    );
  }

  try {
    const result = await runGmailInvoiceScanner();
    return NextResponse.json({
      ok: true,
      via: auth.via,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[invoice-scanner] Unhandled error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** GET kept for simple cron callers that only support GET + secret. */
export async function GET(request: NextRequest) {
  const auth = authorizeRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  return POST(request);
}
