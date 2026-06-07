/** Query flag set when a non-admin hits a protected admin route. */
export const PERMISSION_DENIED_QUERY = "permission_denied";

export function permissionDeniedRedirectPath(): string {
  return `/kanban?${PERMISSION_DENIED_QUERY}=1`;
}
