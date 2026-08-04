import type { NextConfig } from "next";

/** Comma-separated extra dev origins (e.g. Tailscale IP hostnames) for Next.js dev cross-origin allowlist */
const allowedDevOrigins =
  process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sharp", "exifreader"],
  typescript: {
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: allowedDevOrigins.length > 0 ? allowedDevOrigins : undefined,
  experimental: {
    // Large Edited-stage uploads (video/PDF) go through /api/upload as multipart FormData.
    // Both limits must be high enough — Next truncates oversized bodies, which then fails
    // FormData parsing with "Failed to parse body as FormData" / missing boundary errors.
    serverActions: {
      bodySizeLimit: "2000mb",
    },
    proxyClientMaxBodySize: "2000mb",
  },
};

export default nextConfig;
