import { fetchWithTimeout } from "@/lib/server/fetchWithTimeout";
import { graphErrorMessage, sanitizeProviderError } from "@/lib/socialMetricsModel";

const GRAPH_VERSION = "v21.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const GRAPH_TIMEOUT_MS = Number(process.env.META_FETCH_TIMEOUT_MS ?? "20000");

export async function graphGet(
  path: string,
  accessToken: string,
  params: Record<string, string>
): Promise<{ ok: boolean; json: unknown; error: string | null }> {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", accessToken);

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { cache: "no-store" }, GRAPH_TIMEOUT_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "network_error";
    return { ok: false, json: null, error: sanitizeProviderError(message) };
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  const graphError = graphErrorMessage(json);
  if (!response.ok || graphError) {
    return {
      ok: false,
      json,
      error: sanitizeProviderError(graphError || `Graph request failed (${response.status})`),
    };
  }
  return { ok: true, json, error: null };
}

export function isFatalProviderError(message: string | null): boolean {
  if (!message) return false;
  return /token|session has expired|permission|oauth|not authorized|access was revoked|invalid oauth/i.test(message)
    && !/metric|unsupported/i.test(message);
}
