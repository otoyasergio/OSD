import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // Only Next's own guard. On Vercel every Server Action body is still capped
  // at 4.5 MB by the platform (413 before the app runs), so the client sends
  // one photo per request and compresses under that — see lib/forms/uploadLimits.ts.
  experimental: {
    serverActions: {
      bodySizeLimit: "64mb",
    },
  },
  serverExternalPackages: ["sharp"],
  // Allow Playwright / automation hitting 127.0.0.1 while Next binds to localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default withBundleAnalyzer(nextConfig);
