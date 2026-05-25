export function fetchWithTimeout(input, init = {}, timeoutMs = 10_000) {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...init, signal });
}

export function toFetchErrorMessage(error, prefix = "Network request failed") {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return `${prefix}: request timed out`;
  }
  if (error instanceof Error && error.message.trim()) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: network error`;
}
