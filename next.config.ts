import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The platform workspace packages ship raw TypeScript with ESM-style ".js"
  // specifiers (./config.js -> config.ts). Node/tsc/vitest resolve that
  // natively; the bundler needs the explicit transpile opt-in to apply
  // TypeScript resolution inside them. Without this, every route importing
  // @curiolab/* fails `next build` with "Module not found: Can't resolve
  // './x.js'".
  transpilePackages: [
    "@curiolab/core",
    "@curiolab/db",
    "@curiolab/runtime",
    "@curiolab/app",
    "@curiolab/http",
  ],
  // `@curiolab/runtime` (via `next build`) pulls in `@node-rs/argon2`, whose
  // platform binary (`argon2.win32-x64-msvc.node`) webpack cannot parse — the
  // build fails with "Module parse failed: Unexpected character" on the .node
  // file. Marking it a server-external keeps it a runtime `require` instead of
  // bundling it (the correct treatment for a native addon). Not listed in
  // transpilePackages, so no conflict.
  serverExternalPackages: ["@node-rs/argon2"],
  // Map the packages' ESM ".js" specifiers onto their ".ts" sources.
  // TypeScript's NodeNext style writes `./config.js` for a file that exists as
  // `config.ts`. Turbopack has no extensionAlias equivalent, so the dev/build
  // scripts opt out via the documented `--webpack` flag (package.json).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
