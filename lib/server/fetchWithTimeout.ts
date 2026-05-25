export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...init, signal });
}

export function toFetchErrorMessage(error: unknown, prefix = "Network request failed"): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return `${prefix}: request timed out`;
  }
  if (error instanceof Error && error.message.trim()) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: network error`;
}
