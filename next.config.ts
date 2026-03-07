import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use a less common port to avoid conflicts
  // Can be overridden with PORT env var
  ...(process.env.PORT && {
    // Next.js doesn't support port in config, use env var instead
  }),
};

export default nextConfig;
