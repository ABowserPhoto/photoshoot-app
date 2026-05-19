import { Buffer } from "node:buffer";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "meta_ig_account_selection";

type PendingPayload = {
  profileId: string;
  accounts: Array<{
    pageName: string;
    igUsername: string | null;
    igAccountId: string;
    pageAccessToken: string;
  }>;
};

function clearCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function GET() {
  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;

  if (!raw?.trim()) {
    return NextResponse.json({ ok: false as const, error: "no_pending_selection" }, { status: 404 });
  }

  try {
    const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as PendingPayload;
    if (
      !payload?.profileId ||
      !Array.isArray(payload.accounts) ||
      payload.accounts.length === 0
    ) {
      const bad = NextResponse.json({ ok: false as const, error: "invalid_payload" }, { status: 400 });
      clearCookie(bad);
      return bad;
    }

    const res = NextResponse.json({
      ok: true as const,
      profileId: payload.profileId,
      accounts: payload.accounts,
    });
    clearCookie(res);
    return res;
  } catch {
    const bad = NextResponse.json({ ok: false as const, error: "parse_error" }, { status: 400 });
    clearCookie(bad);
    return bad;
  }
}
