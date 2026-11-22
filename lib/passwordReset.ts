/** Same minimum the CRM admin reset already enforces. */
export const MIN_PASSWORD_LENGTH = 8;

export const RESET_LINK_SENT_MESSAGE = "If an account exists, we sent you a link.";

export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";

export type PasswordIssue = "too-short" | "mismatch";

export type RecoveryArrival =
  | { kind: "invalid" }
  | { kind: "exchange"; code: string }
  | { kind: "implicit" }
  | { kind: "session" };

/**
 * Routes that must render without a session. Gallery stays public; the clock
 * widget is handled separately because middleware still resolves its session.
 */
export function isUnauthenticatedAppPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === FORGOT_PASSWORD_PATH || pathname.startsWith(`${FORGOT_PASSWORD_PATH}/`)) {
    return true;
  }
  if (pathname === RESET_PASSWORD_PATH || pathname.startsWith(`${RESET_PASSWORD_PATH}/`)) {
    return true;
  }
  if (pathname === "/gallery" || pathname.startsWith("/gallery/")) return true;
  return false;
}

export function isPasswordResetPath(pathname: string): boolean {
  return pathname === RESET_PASSWORD_PATH || pathname.startsWith(`${RESET_PASSWORD_PATH}/`);
}

/**
 * `redirectTo` for `resetPasswordForEmail`. `origin` is the page origin
 * (`window.location.origin`), so preview hosts stay on the preview host.
 */
export function passwordResetRedirectUrl(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return `${url.origin}${RESET_PASSWORD_PATH}`;
}

export function passwordIssue(password: string, confirmation: string): PasswordIssue | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too-short";
  if (password !== confirmation) return "mismatch";
  return null;
}

export function passwordIssueMessage(issue: PasswordIssue): string {
  switch (issue) {
    case "too-short":
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    case "mismatch":
      return "The passwords do not match.";
    default: {
      const unreachable: never = issue;
      return unreachable;
    }
  }
}

function searchParamsFrom(search: string): URLSearchParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

function hashParamsFrom(hash: string): URLSearchParams {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

function hasLinkError(params: URLSearchParams): boolean {
  return Boolean(params.get("error") || params.get("error_code") || params.get("error_description"));
}

/**
 * PKCE links arrive as `?code=`. Implicit links keep the session in the hash
 * and emit PASSWORD_RECOVERY. Middleware exchanges a code and returns `?recovery=1`.
 */
export function classifyRecoveryArrival(search: string, hash: string): RecoveryArrival {
  const query = searchParamsFrom(search);
  const hashParams = hashParamsFrom(hash);
  if (hasLinkError(query) || hasLinkError(hashParams)) return { kind: "invalid" };

  const code = query.get("code")?.trim() ?? "";
  if (code) return { kind: "exchange", code };

  if (hashParams.get("type") === "recovery" || hashParams.has("access_token")) {
    return { kind: "implicit" };
  }

  if (query.get("recovery") === "1") return { kind: "session" };
  return { kind: "invalid" };
}

/** Drop the one-time code and record whether the recovery session was established. */
export function recoveryLandingUrl(current: URL, outcome: "ready" | "invalid"): URL {
  const next = new URL(current.href);
  next.searchParams.delete("code");
  next.searchParams.delete("error_description");
  next.searchParams.delete("error_code");
  next.hash = "";
  if (outcome === "invalid") {
    next.searchParams.set("error", "invalid");
    next.searchParams.delete("recovery");
  } else {
    next.searchParams.delete("error");
    next.searchParams.set("recovery", "1");
  }
  return next;
}
