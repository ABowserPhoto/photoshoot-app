import { NextResponse } from "next/server";

import { getAuthRole } from "@/lib/server/getAuthRole";

export const dynamic = "force-dynamic";

const JIBBLE_TOKEN_URL = "https://identity.prod.jibble.io/connect/token";

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

async function fetchPersonsFromEndpoint(endpoint: string, accessToken: string) {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const json = (await response.json().catch(() => null)) as unknown;
  return { response, json };
}

export async function GET(request: Request) {
  void request;

  const auth = await getAuthRole();
  if (!auth.authenticated) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accessToken = await getJibbleAccessToken();
    const endpoints = [
      "https://workspace.prod.jibble.io/v1/People",
      "https://api.jibble.io/v1/People",
    ];

    let lastError: string | null = null;
    for (const endpoint of endpoints) {
      const { response, json } = await fetchPersonsFromEndpoint(endpoint, accessToken);
      if (response.ok) {
        return NextResponse.json({
          ok: true,
          endpoint,
          data: json,
        });
      }
      const message =
        (json as { message?: string; error?: string } | null)?.message ||
        (json as { message?: string; error?: string } | null)?.error ||
        `Persons request failed (HTTP ${response.status}).`;
      lastError = `${endpoint}: ${message}`;
    }

    return NextResponse.json(
      {
        ok: false,
        error: lastError || "Failed to fetch persons from Jibble.",
      },
      { status: 502 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Jibble debug-users request failed.",
      },
      { status: 500 }
    );
  }
}
