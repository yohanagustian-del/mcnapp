import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // CSV uploads (team directory, creators seed, master deal import)
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
