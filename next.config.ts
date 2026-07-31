import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source:"/:path*",
      headers:[
        {key:"X-Content-Type-Options",value:"nosniff"},
        {key:"X-Frame-Options",value:"DENY"},
        {key:"Referrer-Policy",value:"no-referrer"},
        {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"},
        {key:"Strict-Transport-Security",value:"max-age=31536000; includeSubDomains"},
        {key:"Content-Security-Policy",value:"default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; connect-src 'self' https://api.github.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"},
      ],
    }];
  },
  env: {
    APP_COMMIT_SHA: process.env.APP_COMMIT_SHA ?? "unknown",
  },
};

export default nextConfig;
