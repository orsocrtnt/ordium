import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Types / packages workspace consommés par le client (types + éventuels helpers).
  transpilePackages: ["@ordium/engine", "@ordium/data", "@ordium/portfolio"],
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    return config;
  },
};

export default nextConfig;
