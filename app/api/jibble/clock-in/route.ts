import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

const JIBBLE_TOKEN_URL = "https://identity.prod.jibble.io/connect/token";
const JIBBLE_TIME_ENTRIES_URL = "https://time-tracking.prod.jibble.io/v1/TimeEntries";

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const key = serviceKey || anonKey;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getSessionUserId(): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // No-op for route reads.
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function gatekeeperFallbackEmployeeId(role: "admin" | "editor"): string | null {
  const roleKey = role === "admin" ? "JIBBLE_ADMIN_EMPLOYEE_ID" : "JIBBLE_EDITOR_EMPLOYEE_ID";
  const roleValue = process.env[roleKey]?.trim();
  if (roleValue) {
    return roleValue;
  }
  return process.env.JIBBLE_GATEKEEPER_EMPLOYEE_ID?.trim() || null;
}

async function resolveJibbleEmployeeId(params: {
  userId: string | null;
  role: "admin" | "editor";
}): Promise<{ id: string | null; notLinked: boolean }> {
  const { userId, role } = params;
  if (userId) {
    const sb = serviceSupabase();
    if (sb) {
      const { data, error } = await sb
        .from("profiles")
        .select("jibble_employee_id")
        .eq("id", userId)
        .maybeSingle();
      if (!error) {
        const value = (data as { jibble_employee_id?: unknown } | null)?.jibble_employee_id;
        if (typeof value === "string" && value.trim()) {
          return { id: value.trim(), notLinked: false };
        }
      }
    }
    // No per-user mapping found — require explicit linking.
    return { id: null, notLinked: true };
  }

  return { id: gatekeeperFallbackEmployeeId(role), notLinked: false };
}

async function getJibbleAccessToken(): Promise<string> {
  const clientId = process.env.JIBBLE_CLIENT_ID?.trim();
  const clientSecret = process.env.JIBBLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing JIBBLE_CLIENT_ID or JIBBLE_CLIENT_SECRET in environment.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const response = await fetch(JIBBLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  const json = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        error_description?: string;
        error?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      json?.error_description ||
        json?.error ||
        `Jibble token handshake failed (HTTP ${response.status}).`
    );
  }

  const token = json?.access_token?.trim();
  if (!token) {
    throw new Error("Jibble token handshake succeeded but access_token was missing.");
  }
  return token;
}

function formatJibbleError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const directMessageCandidates = [
    record.message,
    record.error_description,
    record.error,
    record.title,
    record.detail,
  ];
  for (const candidate of directMessageCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return fallback;
  }
}

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
    const accessToken = await getJibbleAccessToken();
    const payload = {
      personId: employeeId,
      type: "In",
      clientType: "Web",
      platform: {
        clientVersion: "web 3.0",
        os: "Windows 11",
        deviceModel: "Studio App Custom Widget",
        deviceName: "Studio Desktop App",
      },
    };

    const response = await fetch(JIBBLE_TIME_ENTRIES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const json = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const errorMessage = formatJibbleError(
        json,
        `Jibble clock-in failed (HTTP ${response.status}).`
      );
      console.error("[jibble clock-in] request failed", {
        status: response.status,
        employeeId,
        payload,
        response: json,
      });
      return NextResponse.json(
        {
          ok: false,
          error: errorMessage,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({ ok: true, employeeId, type: "In", raw: json });
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
