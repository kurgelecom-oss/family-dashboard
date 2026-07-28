import { NextResponse } from "next/server";
import { fetchAllRows, WEEKLY_TARGET, type Row } from "../route";

/* ────────────────────────────────────────────────────────────────────────────
   /api/origins/rows — every row, for the /origins tracker page.

   Split from /api/origins deliberately: the strip is on every route and only
   ever needs two summaries, so it should not pay for 105 rows on every page
   load. Same caching posture as its sibling — per-request render, 300s declared
   per response, failure never cached.
   ──────────────────────────────────────────────────────────────────────────── */
export const dynamic = "force-dynamic";

const SWR_SECONDS = 300;
const CACHE_TTL_MS = 300_000;
const CACHE_FAIL = "no-store";

let cached: { rows: Row[]; expiresAt: number } | null = null;

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";

  if (!force && cached && cached.expiresAt > Date.now()) {
    const remaining = Math.max(0, Math.ceil((cached.expiresAt - Date.now()) / 1000));
    return NextResponse.json(
      { rows: cached.rows, weeklyTarget: WEEKLY_TARGET },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${remaining}, stale-while-revalidate=${SWR_SECONDS}`,
          "X-Origins-Cache": "hit",
          "Netlify-Vary": "query=refresh",
        },
      },
    );
  }

  try {
    const rows = await fetchAllRows();
    // Module order, then lesson order — the order the course is taken in, which
    // is the only order this page should ever present.
    rows.sort((a, b) => a.moduleNo - b.moduleNo || a.lessonNo - b.lessonNo);

    cached = { rows, expiresAt: Date.now() + CACHE_TTL_MS };

    return NextResponse.json(
      { rows, weeklyTarget: WEEKLY_TARGET },
      {
        headers: {
          "Cache-Control": force
            ? CACHE_FAIL
            : `public, s-maxage=300, stale-while-revalidate=${SWR_SECONDS}`,
          "X-Origins-Cache": "miss",
          "X-Origins-Rows": String(rows.length),
          "Netlify-Vary": "query=refresh",
        },
      },
    );
  } catch (error) {
    console.error("[/api/origins/rows]", error);
    return NextResponse.json(
      { error: "origins_unavailable", message: String(error) },
      { status: 503, headers: { "Cache-Control": CACHE_FAIL, "Netlify-Vary": "query=refresh" } },
    );
  }
}
