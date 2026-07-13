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
};

export default withBundleAnalyzer(nextConfig);
