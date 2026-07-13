import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // Six intake photos at create can approach the per-file 10 MB cap.
  experimental: {
    serverActions: {
      bodySizeLimit: "64mb",
    },
  },
  // Allow Playwright / automation hitting 127.0.0.1 while Next binds to localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default withBundleAnalyzer(nextConfig);
