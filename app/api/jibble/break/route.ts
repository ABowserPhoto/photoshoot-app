import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import {
  getSessionUserId,
  postJibbleBreakEntry,
  resolveJibbleEmployeeId,
} from "@/lib/server/jibbleTimeEntries";

export const dynamic = "force-dynamic";

/**
 * POST /api/jibble/break
 * Starts a Jibble break via TimeEntries type "StartBreak".
 * Optional body: `{ "breakId": "<uuid>" }` for custom schedule breaks;
 * otherwise uses `JIBBLE_BREAK_ID` or the first available GetBreaks policy
 * (free-form orgs can omit breakId entirely).
 */
export async function POST(request: Request) {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const userId = await getSessionUserId();
  const { id: employeeId, notLinked } = await resolveJibbleEmployeeId({ userId, role: auth.role });
  if (!employeeId) {
    return NextResponse.json(
      {
        ok: false,
        error: notLinked
          ? "Your account is not linked to Jibble. Ask an admin to link your account in User Management."
          : "No Jibble employee mapping found. Configure JIBBLE_*_EMPLOYEE_ID env vars.",
      },
      { status: 400 }
    );
  }

  let breakId: string | null = null;
  try {
    const body = (await request.json().catch(() => null)) as { breakId?: unknown } | null;
    if (typeof body?.breakId === "string" && body.breakId.trim()) {
      breakId = body.breakId.trim();
    }
  } catch {
    // Empty / non-JSON body is fine — breakId stays optional.
  }

  try {
    const result = await postJibbleBreakEntry({ employeeId, breakId });
    if (!result.ok) {
      console.error("[jibble break] request failed", {
        status: result.status,
        employeeId,
        breakId,
        response: result.raw,
      });
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      employeeId: result.employeeId,
      type: "StartBreak",
      breakId: result.breakId,
      mode: "break",
      raw: result.raw,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Jibble break failed.",
      },
      { status: 500 }
    );
  }
}
