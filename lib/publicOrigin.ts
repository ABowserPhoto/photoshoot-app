/**
 * Public origin for server-side calls back into this app (e.g. fetch("/api/...") from a route).
 * Behind Cloudflare Tunnel or another reverse proxy, `request.url` may show an internal host;
 * prefer NEXT_PUBLIC_APP_URL or X-Forwarded-* when present.
 */
export function resolvePublicOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0]?.trim() ?? "";
    if (host) {
      const proto =
        request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
      return `${proto}://${host}`;
    }
  }

  return new URL(request.url).origin;
}
