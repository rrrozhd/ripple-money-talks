import type { NextConfig } from "next";

const AGENT_URL = process.env.NEXT_PUBLIC_RIPPLE_AGENT_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Proxy the ripple-app agent API so the browser stays same-origin (the backend has no CORS).
  async rewrites() {
    return AGENT_URL ? [{ source: "/rapi/:path*", destination: `${AGENT_URL}/api/:path*` }] : [];
  },
  // Hide the Next.js dev-only "N" badge; build and runtime errors still surface.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
