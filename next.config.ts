import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    APP_COMMIT_SHA: process.env.APP_COMMIT_SHA ?? "unknown",
  },
};

export default nextConfig;
