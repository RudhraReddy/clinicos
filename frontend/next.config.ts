import type { NextConfig } from "next";
import pkg from "./package.json";

// App version shown in the sidebar. Single source of truth: "version" in
// package.json -- bump it there (major.minor.patch) with each release.
// RENDER_GIT_COMMIT is set by Render during its build, so the deployed
// commit is shown alongside without any manual step.
const commit = (process.env.RENDER_GIT_COMMIT || "").slice(0, 7);

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_APP_COMMIT: commit,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_URL || 'http://127.0.0.1:5000'}/api/:path*`,
      },
    ]
  },
};

export default nextConfig;
