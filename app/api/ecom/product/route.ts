import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  launchpad,
  type LaunchpadEntryRecord,
  type LaunchpadTestRecord,
} from "../../../lib/launchpad";

/* ════════════════════════════════════════════════════════════════════════════
   GET /api/ecom/product?id=<test uuid>

   Same-origin feed for the Auto mode on /profit.html. The calculator is a
   static page under public/ and cannot import server helpers, so it calls this
   route rather than the Launchpad API cross-origin.

   Rendered per request — it reads a query param, so it cannot be `force-static`
   like the sibling dashboard route. The 60s lifetime is declared per response
   (same reason as /api/board: a baked response cannot be conditionally
   uncacheable, and the error paths here must not be cached).

   Everything the calculator needs is COMPUTED, never copied:
     · orders / ad spend / COGS  → summed over the test's whole life, then
                                   divided by weeks elapsed, because the
                                   calculator stores flow figures weekly.
     · AOV                       → a ratio (revenue ÷ orders), so it is NOT
                                   weekly-normalised.
     · feesPct                   → the only direct copy (fee_pct × 100).
   ══════════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const CACHE_SECONDS = 60;

/** Below this, a derived AOV is noise dressed up as a number. */
const MIN_CONFIDENT_ORDERS = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Inclusive day span between two civil dates. Both are plain "YYYY-MM-DD"
 * strings, so this is pure calendar arithmetic through Date.UTC — no timezone
 * and no hardcoded offset (which would be wrong for half the year in Sydney).
 */
function inclusiveDays(first: string, last: string): number {
  const [fy, fm, fd] = first.split("-").map(Number);
  const [ly, lm, ld] = last.split("-").map(Number);
  if ([fy, fm, fd, ly, lm, ld].some((n) => !Number.isFinite(n))) return 1;
  const ms = Date.UTC(ly, lm - 1, ld) - Date.UTC(fy, fm - 1, fd);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

function fail(status: number, error: string) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get("id") ?? "").trim();

  if (!id) return fail(400, "No product ID supplied.");
  if (!UUID_RE.test(id)) {
    return fail(
      400,
      "That does not look like a product ID. Paste the full 36-character test UUID.",
    );
  }

  let tests: LaunchpadTestRecord[];
  let entries: LaunchpadEntryRecord[];
  try {
    // /entries requires test_id — omitting it is a 400 upstream, not an empty list.
    [tests, entries] = await Promise.all([
      launchpad<LaunchpadTestRecord[]>("/tests", CACHE_SECONDS),
      launchpad<LaunchpadEntryRecord[]>(
        `/entries?test_id=${encodeURIComponent(id)}`,
        CACHE_SECONDS,
      ),
    ]);
  } catch {
    return fail(502, "Launchpad is not responding. Figures unchanged.");
  }

  // No single-record form is exposed upstream, so filter the list.
  const test = tests.find((t) => t.id === id) ?? null;
  if (!test) return fail(404, "No product with that ID exists in Launchpad.");

  const dated = entries
    .filter((e) => typeof e.entry_date === "string" && e.entry_date)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));

  if (dated.length === 0) {
    return fail(
      422,
      `"${test.name}" has no daily entries yet, so there is nothing to load.`,
    );
  }

  const firstDate = dated[0].entry_date;
  const lastDate = dated[dated.length - 1].entry_date;
  const days = inclusiveDays(firstDate, lastDate);
  const weeks = days / 7;

  const bundles = test.bundles_config ?? [];

  let totalOrders = 0;
  let totalRevenue = 0;
  let totalSpend = 0;
  let bundleUnits = 0;
  let bundleCogs = 0;

  for (const e of dated) {
    totalOrders += e.orders ?? 0;
    totalRevenue += e.revenue ?? 0;
    totalSpend += e.meta_spend ?? 0;

    for (const b of e.bundle_breakdown ?? []) {
      const n = b.count ?? 0;
      if (n <= 0) continue;
      bundleUnits += n;
      // A 2x line is a 2-pack with its own COGS, not two singles.
      const def = bundles.find((x) => x.id === b.bundle_id);
      if (def) bundleCogs += n * def.cogs;
    }
  }

  // Bundle mix is the accurate basis; per-unit × orders is the flat estimate.
  const cogsEstimated = bundleUnits === 0;
  const totalCogs = cogsEstimated
    ? (test.cogs_per_unit ?? 0) * totalOrders
    : bundleCogs;

  // A ratio, not a flow — deliberately NOT divided by weeks.
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : null;

  const feesPct = test.fee_pct === null ? null : test.fee_pct * 100;

  const reasons: string[] = [];
  if (totalOrders < MIN_CONFIDENT_ORDERS) {
    reasons.push(
      `only ${totalOrders} order${totalOrders === 1 ? "" : "s"} recorded`,
    );
  }
  if (aov === null) reasons.push("no orders yet, so AOV could not be derived");
  if (cogsEstimated) {
    reasons.push("bundle mix is empty — COGS estimated from per-unit cost");
  }
  if (test.cogs_verified !== true) {
    reasons.push("COGS not verified in Launchpad");
  }

  return NextResponse.json(
    {
      ok: true,
      test: {
        id: test.id,
        name: test.name,
        status: test.status,
        cogsVerified: test.cogs_verified,
      },
      window: { firstDate, lastDate, days, weeks: round2(weeks) },
      totals: {
        orders: totalOrders,
        revenue: round2(totalRevenue),
        adSpend: round2(totalSpend),
        cogs: round2(totalCogs),
        bundleUnits,
      },
      // Already weekly — assign straight into the calculator's `base`.
      weekly: {
        orders: round2(totalOrders / weeks),
        cogs: round2(totalCogs / weeks),
        ads: round2(totalSpend / weeks),
      },
      aov: aov === null ? null : round2(aov),
      feesPct: feesPct === null ? null : round2(feesPct),
      cogsEstimated,
      lowConfidence: reasons.length > 0,
      reasons,
      /** No field on the calculator holds a fixed per-transaction fee. */
      unmapped: { fee_fixed: test.fee_fixed },
    },
    {
      headers: {
        "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}`,
      },
    },
  );
}
