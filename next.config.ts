import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "pg"],
  experimental: { serverActions: { bodySizeLimit: "45mb" } },
};
export default config;
