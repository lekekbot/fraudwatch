import type { NextConfig } from "next";

// FraudWatch ships as a static bundle: no server, no API routes, no app database.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
