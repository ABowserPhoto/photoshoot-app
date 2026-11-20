/**
 * Supabase auth-js re-emits SIGNED_IN from `_recoverAndRefresh` every time a
 * hidden document becomes visible, and emits TOKEN_REFRESHED when the access
 * token is renewed. Those events are session recovery, not a new login.
 * Reloading app auth state for them (especially with a loading gate) unmounts
 * the current module and drops in-memory UI state.
 */
export function shouldReloadAuthRoleOnEvent(
  event: string,
  sessionUserId: string | null,
  currentUserId: string | null
): boolean {
  if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
    return false;
  }
  if (event === "SIGNED_IN" && sessionUserId && sessionUserId === currentUserId) {
    return false;
  }
  return true;
}

/**
 * Once a module has been shown, a later auth loading pass must not replace it.
 * The loading flag is for the first session check only.
 */
export function shouldKeepModuleTreeMounted(params: {
  isLoading: boolean;
  authenticated: boolean;
  allowed: boolean;
  hasShownModule: boolean;
}): boolean {
  return (
    params.isLoading &&
    params.hasShownModule &&
    params.authenticated &&
    params.allowed
  );
}

/** Same-origin return path for /login?redirect=… after a session expires. */
export function loginHrefWithRedirect(returnTo: string): string {
  const path = returnTo.trim();
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/\\") ||
    path.startsWith("/login")
  ) {
    return "/login";
  }
  return `/login?redirect=${encodeURIComponent(path)}`;
}
