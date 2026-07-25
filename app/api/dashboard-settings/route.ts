import { NextResponse } from "next/server";
import { loadSettings } from "../../lib/settings";

/*
 * Cached for 30 minutes — the CACHE_MINUTES default.
 *
 * Next requires this value to be statically analysable ("revalidate = 600 is
 * valid, but revalidate = 60 * 10 is not"), so it cannot literally be read from
 * the setting it configures. The fetched CACHE_MINUTES is returned as
 * `cacheSeconds` and is what the downstream data routes use for their own
 * upstream fetches, so changing it in Notion still takes effect there.
 *
 * NOTE: this is a separate endpoint from /api/settings, which serves the ANSAR
 * FC points gate for column D on a 5-minute cache and must not be disturbed.
 */
export const dynamic = "force-static";
export const revalidate = 1800;

export async function GET() {
  try {
    const { settings, types, inactive, unparsed, cacheSeconds } = await loadSettings();

    return NextResponse.json({
      settings,
      types,
      inactive,
      unparsed,
      cacheSeconds,
      count: Object.keys(settings).length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching dashboard settings:", error);
    // Fail loudly. Consumers apply their built-in defaults and warn per key
    // rather than receiving a map of invented values.
    return NextResponse.json({ error: "Failed to fetch dashboard settings" }, { status: 500 });
  }
}
