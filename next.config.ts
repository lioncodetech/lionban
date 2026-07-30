import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

const nextConfig: NextConfig = {
  env: {
    APP_COMMIT_SHA: commitSha,
  },
};

export default nextConfig;
