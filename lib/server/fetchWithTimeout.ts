import { Agent, fetch as undiciFetch } from "undici";

/**
 * fetch wrapper that aligns undici headers/body timeouts with the caller's timeoutMs.
 * Node's default headersTimeout (~300s) is shorter than our merge pipeline (RawTherapee + SNS-HDR),
 * which caused `TypeError: fetch failed` / UND_ERR_HEADERS_TIMEOUT on long brackets.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connectTimeout: Math.min(Math.max(timeoutMs, 10_000), 120_000),
  });
  return undiciFetch(input, { ...init, signal, dispatcher }) as Promise<Response>;
}

export function toFetchErrorMessage(error: unknown, prefix = "Network request failed"): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return `${prefix}: request timed out`;
  }
  const cause =
    error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeCode =
    cause && typeof cause === "object" && cause !== null && "code" in cause
      ? String((cause as { code?: unknown }).code)
      : "";
  if (causeCode === "UND_ERR_HEADERS_TIMEOUT") {
    return `${prefix}: server did not respond in time (headers timeout — merge may still be running on Next.js)`;
  }
  if (causeCode === "UND_ERR_BODY_TIMEOUT") {
    return `${prefix}: response body timed out`;
  }
  if (error instanceof Error && error.message.trim()) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: network error`;
}
