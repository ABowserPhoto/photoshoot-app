import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";
import {
  getSessionUserId,
  postJibbleTimeEntry,
  resolveJibbleEmployeeId,
} from "@/lib/server/jibbleTimeEntries";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  void request;
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

  try {
    const result = await postJibbleTimeEntry({ employeeId, type: "In" });
    if (!result.ok) {
      console.error("[jibble clock-in] request failed", {
        status: result.status,
        employeeId,
        response: result.raw,
      });
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      employeeId: result.employeeId,
      type: "In",
      mode: "working",
      raw: result.raw,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Jibble clock-in failed.",
      },
      { status: 500 }
    );
  }
}
