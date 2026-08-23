import { NextResponse } from "next/server";

import { GATE_COOKIE } from "@/lib/authCookies";
import { deriveGateToken } from "@/lib/gateToken";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.APP_AUTH_SECRET?.trim();
  const adminPassword = process.env.APP_ADMIN_PASSWORD?.trim();
  const editorPassword = process.env.APP_EDITOR_PASSWORD?.trim();

  if (!secret || !adminPassword || !editorPassword) {
    return NextResponse.json(
      {
        error:
          "Password gate is not configured. Set APP_AUTH_SECRET, APP_ADMIN_PASSWORD, and APP_EDITOR_PASSWORD, or use Supabase Auth.",
      },
      { status: 503 }
    );
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  let matchedPassword: string | null = null;
  let role: "admin" | "editor" | null = null;

  if (password === adminPassword) {
    matchedPassword = adminPassword;
    role = "admin";
  } else if (password === editorPassword) {
    matchedPassword = editorPassword;
    role = "editor";
  }

  if (!matchedPassword || !role) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  const token = await deriveGateToken(secret, matchedPassword);
  const res = NextResponse.json({ success: true, role });
  res.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
