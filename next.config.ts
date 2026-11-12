import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  distDir: process.env.TRAVEL_STORY_DIST_DIR || ".next",
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
