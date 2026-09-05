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
      // /mission moved off this origin entirely: the manifesto page now renders
      // the board itself from /api/mission, so hosting a second copy here was
      // two surfaces drifting apart. Same 308 as /week — the move is permanent
      // and the method must survive it. /api/mission is NOT affected: `source`
      // matches "/mission" exactly, and the route the manifesto fetches stays.
    ];
  },
};

export default nextConfig;
