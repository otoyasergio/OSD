import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Six intake photos at create can approach the per-file 10 MB cap.
  experimental: {
    serverActions: {
      bodySizeLimit: "64mb",
    },
  },
};

export default nextConfig;
