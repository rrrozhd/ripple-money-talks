import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
