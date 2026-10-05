import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  calculateOffers,
  offerAtPrice,
  ASSUMPTIONS,
} from "../../../public/offer-model.mjs";

/* ════════════════════════════════════════════════════════════════════════════
   GET /api/offer?costs=9.4,12.4,15.9&prices=49.95,79.95,99.95

   The Offer Engine for agents. /offer.html is the same maths for a person; this
   is it as JSON, so a seat (CLEO at Offer Architecture, TARA at validation,
   GARY at the spend check-in) can grade an offer with one curl instead of
   re-deriving the formulas in prose and drifting from the page.

     costs   landed, delivered total per tier, 1 to 4 values, in tier order
     prices  retail price per tier, same order. Optional: without it each tier
             comes back with the four solved margin rows only.

   It REPORTS. Nothing here blocks a step: a red verdict is a finding for tk,
   never a gate (tk, 2 Oct 2026: the human decides).

   no-store for the reason given in ../ecom/product/route.ts: the Netlify edge
   cache key ignores the query string, so a cached body would answer one
   product's figures for another's.
   ══════════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };
const WORDS = { good: "works", tight: "tight", bad: "loses money" } as const;
/** CLEO's take mixes, agents/cleo_tasks/offer.md §2. Share of orders per tier. */
const MIXES = {
  conservative: [0.7, 0.25, 0.05],
  expected: [0.45, 0.4, 0.15],
  strong: [0.3, 0.45, 0.25],
};

const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const usd = (n: number) => `$${n.toFixed(2)}`;

function fail(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400, headers: HEADERS });
}

/** "9.4,12.4" → [9.4, 12.4]; a blank entry is null; anything else is an error. */
function numbers(raw: string | null): (number | null)[] | string {
  if (!raw) return [];
  const out: (number | null)[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t === "") { out.push(null); continue; }
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0 || n > 100000) return `"${t.slice(0, 20)}" is not an amount between 0 and 100000.`;
    out.push(n);
  }
  return out;
}

function verdict(target: number, breakEven: number, cap: number) {
  return target >= cap ? "good" : breakEven >= cap ? "tight" : "bad";
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const costs = numbers(q.get("costs"));
  const prices = numbers(q.get("prices"));
  if (typeof costs === "string") return fail(`costs: ${costs}`);
  if (typeof prices === "string") return fail(`prices: ${prices}`);
  if (costs.length < 1 || costs.length > 4 || costs.some((c) => c === null)) {
    return fail("costs: give 1 to 4 landed pack totals, comma separated, e.g. costs=9.4,12.4,15.9");
  }
  if (prices.length > costs.length) return fail("prices: more prices than costs.");

  const cap = ASSUMPTIONS.floorCpa;
  const tiers = (costs as number[]).map((cost, i) => {
    const price = prices[i] ?? null;
    const solved = calculateOffers({ cost });
    const base = {
      tier: i + 1,
      landed_cost: cost,
      lowest_price_that_passes: r2(solved[0].floor),
      solved_prices: solved.map((s) => ({
        margin_pct: s.tierPct, price: r2(s.price), target_cpa: r2(s.targetCpa),
        break_even_cpa: r2(s.breakEvenCpa), verdict: WORDS[s.verdict as keyof typeof WORDS],
      })),
    };
    if (price === null) return { ...base, price: null };
    const o = offerAtPrice({ cost, price });
    const word = WORDS[o.verdict as keyof typeof WORDS];
    return {
      ...base,
      price,
      margin_pct: o.tierPct,
      target_cpa: r2(o.targetCpa),
      break_even_cpa: r2(o.breakEvenCpa),
      roas_needed: r2(o.roasNeeded),
      left_per_order_at_planning_cpa: r2(o.profit),
      max_landed_cost_at_this_price: r2(o.maxCost),
      verdict: word,
      line:
        o.verdict === "good"
          ? `Tier ${i + 1} at ${usd(price)} works: ${usd(o.targetCpa)} to buy a customer against a ${usd(cap)} planning CPA. Cost cap ${usd(o.targetCpa)}, turn ads off above ${usd(o.breakEvenCpa)}.`
          : o.verdict === "tight"
            ? `Tier ${i + 1} at ${usd(price)} is tight: it makes ${usd(o.profit)} an order at a ${usd(cap)} CPA but keeps under ${ASSUMPTIONS.keepPct}%. It passes at ${usd(o.floor)}.`
            : `Tier ${i + 1} at ${usd(price)} loses ${usd(cap - o.breakEvenCpa)} an order at a ${usd(cap)} CPA. It passes at ${usd(o.floor)}.`,
    };
  });

  // One order costs one CPA whichever tier it holds, so ads are judged on the mix.
  const priced = tiers.every((t) => t.price !== null) && tiers.length === 3;
  const mixes = priced
    ? Object.fromEntries(
        Object.entries(MIXES).map(([name, w]) => {
          const sum = (f: (t: (typeof tiers)[number]) => number) =>
            tiers.reduce((a, t, i) => a + w[i] * f(t), 0);
          const target = sum((t) => (t as { target_cpa: number }).target_cpa);
          const breakEven = sum((t) => (t as { break_even_cpa: number }).break_even_cpa);
          return [name, {
            share_per_tier: w,
            aov: r2(sum((t) => t.price as number)),
            target_cpa: r2(target),
            break_even_cpa: r2(breakEven),
            verdict: WORDS[verdict(target, breakEven, cap)],
          }];
        }),
      )
    : null;

  // Not request.nextUrl.origin: on Netlify that is the per-deploy hostname, which
  // would pin the link to one build and to that build's own saved figures.
  const link = new URL("https://kurgel-dashboard.netlify.app/offer.html");
  link.searchParams.set("costs", (costs as number[]).join(","));
  if (prices.length) link.searchParams.set("prices", prices.map((p) => p ?? "").join(","));

  return NextResponse.json(
    {
      ok: true,
      currency: "USD",
      assumptions: {
        planning_cpa: cap,
        planning_cpa_source: "mission-control-web/src/lib/radar/gates.json direct_path.planning_cpa_usd",
        keep_pct_after_ads: ASSUMPTIONS.keepPct,
        returns: "none deducted",
        payment_fee: "2.9% + $0.30",
        gst: "none",
      },
      how_to_read: {
        works: `target CPA is at or above the planning CPA: pays for the customer and keeps ${ASSUMPTIONS.keepPct}% or more`,
        tight: `break-even CPA covers the planning CPA but target CPA does not: profitable, keeps under ${ASSUMPTIONS.keepPct}%`,
        "loses money": "break-even CPA is under the planning CPA",
        rule: "These are findings to report to tk. They never block a step.",
      },
      tiers,
      mixes,
      open_in_offer_engine: link.toString(),
    },
    { headers: HEADERS },
  );
}
