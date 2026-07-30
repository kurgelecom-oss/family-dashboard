/* ════════════════════════════════════════════════════════════════════════════
   Shared read client for the ECOM Launchpad backend (product-test-engine).

   Exists so /api/ecom/product reuses the exact fetch + revalidate helper the
   dashboard route already uses instead of standing up a second API client.

   app/api/ecom/route.ts deliberately keeps its own private copy of this helper:
   it is a `force-static` cached route feeding the live dashboard, and rewiring
   its imports is a change to working production code that this feature does
   not require. If that route is ever touched for its own reasons, fold it in
   then — the fetch semantics here are identical.
   ══════════════════════════════════════════════════════════════════════════ */

/** Public read-only API of the ECOM Launchpad's backend. No auth required. */
export const LAUNCHPAD_API = "https://product-test-engine.netlify.app/api";

export interface LaunchpadBundle {
  id: number;
  qty: number;
  cogs: number;
  name: string;
}

/**
 * A Launchpad test record — what the calculator calls a "product".
 *
 * Note what is NOT here: there is no selling price. `selling_prices` comes back
 * as `[]` and `bundles_config` carries only per-bundle COGS, so AOV cannot be
 * copied from this record and must be derived from realised entry revenue.
 */
export interface LaunchpadTestRecord {
  id: string;
  name: string;
  status: string;
  cogs_per_unit: number | null;
  /** Launchpad's own verification flag on the COGS figures. */
  cogs_verified: boolean | null;
  bundles_config: LaunchpadBundle[] | null;
  /** A target, not actual spend — never read this as ad spend. */
  target_cpa: number | null;
  fee_pct: number | null;
  fee_fixed: number | null;
  launch_date: string | null;
  first_spend_at: string | null;
  created_at: string;
}

export interface LaunchpadBundleCount {
  bundle_id: number;
  count: number | null;
}

export interface LaunchpadEntryRecord {
  /** Plain civil date, "YYYY-MM-DD". No timezone involved in differencing two. */
  entry_date: string;
  orders: number | null;
  revenue: number | null;
  meta_spend: number | null;
  /** Null on every observed row — derive AOV from revenue/orders instead. */
  aov: number | null;
  bundle_breakdown: LaunchpadBundleCount[] | null;
}

export async function launchpad<T>(
  path: string,
  cacheSeconds: number,
): Promise<T> {
  const res = await fetch(`${LAUNCHPAD_API}${path}`, {
    next: { revalidate: cacheSeconds },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Launchpad ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}
