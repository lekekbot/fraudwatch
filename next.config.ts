import type { NextConfig } from "next";

// The Next server only delivers the UI; case data and RPC access stay in the browser.
const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
