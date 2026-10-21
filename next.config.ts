import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // The vendored ThreeUI package ships TypeScript source.
  transpilePackages: ["@designcodeio/threeui"],
  webpack(config) {
    // Import .glsl shader files as plain strings.
    config.module.rules.push({
      test: /\.(glsl|vert|frag)$/,
      type: "asset/source",
    });
    // Support Vite-style `?raw` imports used by the vendored ThreeUI source.
    config.module.rules.push({
      resourceQuery: /raw/,
      type: "asset/source",
    });
    // threeui.css references a font that is not part of the registered bundle
    // and is unused by the Original variant; resolve it to nothing.
    config.resolve.alias = {
      ...config.resolve.alias,
      [path.resolve("vendor/threeui/src/shaders/fonts/fragment-mono.woff2")]: false,
    };
    return config;
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
