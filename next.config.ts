import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /week is superseded by /board. Redirects are checked before the filesystem,
  // so app/week/page.tsx stays on disk but is unreachable. `permanent: true` is
  // a 308 — Next uses 307/308, not 302/301, to preserve the request method.
  async redirects() {
    return [
      {
        source: "/week",
        destination: "/board",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
