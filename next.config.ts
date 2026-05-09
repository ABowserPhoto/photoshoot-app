import type { NextConfig } from "next";

/** Comma-separated extra dev origins (e.g. Tailscale IP hostnames) for Next.js dev cross-origin allowlist */
const allowedDevOrigins =
  process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: allowedDevOrigins.length > 0 ? allowedDevOrigins : undefined,
  experimental: {
    proxyClientMaxBodySize: 1024 * 1024 * 1024,
  },
};

export default nextConfig;
