import { NextResponse } from "next/server";

import { getAdminAreaAuth } from "@/lib/server/getAdminAreaAuth";

export const dynamic = "force-dynamic";

const JIBBLE_TOKEN_URL = "https://identity.prod.jibble.io/connect/token";
const JIBBLE_PEOPLE_URL = "https://workspace.prod.jibble.io/v1/People";

export type JibblePerson = {
  id: string;
  name: string;
};

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
    | { access_token?: string; error_description?: string; error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      json?.error_description ||
        json?.error ||
        `Jibble token request failed (HTTP ${response.status}).`
    );
  }

  const token = json?.access_token?.trim();
  if (!token) {
    throw new Error("Jibble token request succeeded but access_token was missing.");
  }
  return token;
}

function extractName(person: Record<string, unknown>): string {
  // Jibble People records use "name" or "fullName" or firstName+lastName.
  if (typeof person.name === "string" && person.name.trim()) {
    return person.name.trim();
  }
  if (typeof person.fullName === "string" && person.fullName.trim()) {
    return person.fullName.trim();
  }
  const parts = [
    typeof person.firstName === "string" ? person.firstName.trim() : "",
    typeof person.lastName === "string" ? person.lastName.trim() : "",
  ].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" ");
  }
  if (typeof person.email === "string" && person.email.trim()) {
    return person.email.trim();
  }
  return "(unnamed)";
}

/**
 * GET /api/jibble/users
 *
 * Admin-only route. Fetches the member list from the Jibble workspace
 * and returns a simplified array of { id, name }.
 */
export async function GET() {
  const auth = await getAdminAreaAuth();
  if (!auth.authenticated || !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const accessToken = await getJibbleAccessToken();

    const response = await fetch(JIBBLE_PEOPLE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    const raw = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const message =
        raw && typeof raw === "object"
          ? ((raw as Record<string, unknown>).message as string | undefined) ??
            ((raw as Record<string, unknown>).error as string | undefined) ??
            `Jibble People request failed (HTTP ${response.status}).`
          : `Jibble People request failed (HTTP ${response.status}).`;
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // The Jibble workspace API returns either a plain array or { value: [...] }
    const items: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as Record<string, unknown>)?.value)
        ? ((raw as Record<string, unknown>).value as unknown[])
        : [];

    const people: JibblePerson[] = items
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => {
        const id =
          typeof item.id === "string"
            ? item.id.trim()
            : typeof item.personId === "string"
              ? item.personId.trim()
              : "";
        return { id, name: extractName(item) };
      })
      .filter((p) => p.id !== "")
      .sort((a, b) => a.name.localeCompare(b.name, "de"));

    return NextResponse.json({ ok: true, people });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to fetch Jibble users.",
      },
      { status: 500 }
    );
  }
}
