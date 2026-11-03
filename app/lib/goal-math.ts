/* Pure maths behind the family goal measures (lib/goal-measures.ts). Tested in goal-math.test.ts. */
const TZ = 'Australia/Melbourne';

/** Monday of this week in Melbourne, and of last week, as YYYY-MM-DD. */
export function weekBounds(now = new Date()) {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now) + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  const mon = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() - 7);
  return { mon, lastMon: d.toISOString().slice(0, 10) };
}

export type LpTest = { id: string; name: string; status: string; launch_date: string | null; created_at: string; fee_pct: number | null; fee_fixed: number | null; bundles_config: { id: number; cogs: number }[] | null };
export type LpEntry = { entry_date: string; orders: number | null; revenue: number | null; meta_spend: number | null; bundle_breakdown: { bundle_id: number; count: number | null }[] | null; profit_snapshot: { cogs?: number; fees?: number; refunds?: number; shipping?: number; other?: number; overhead?: number } | null };

/** One day's profit. Launchpad's own cost snapshot when the entry has one, else COGS from the
    bundle mix (or the cheapest bundle per order) and the test's card fees. */
export function entryProfit(e: LpEntry, t: LpTest): number {
  const rev = e.revenue ?? 0, spend = e.meta_spend ?? 0, orders = e.orders ?? 0, s = e.profit_snapshot;
  if (s && typeof s.cogs === 'number') return rev - spend - s.cogs - (s.fees ?? 0) - (s.refunds ?? 0) - (s.shipping ?? 0) - (s.other ?? 0) - (s.overhead ?? 0);
  const bundles = t.bundles_config ?? [];
  const byMix = (e.bundle_breakdown ?? []).reduce((a, b) => a + (b.count ?? 0) * (bundles.find(x => x.id === b.bundle_id)?.cogs ?? 0), 0);
  const cogs = byMix || orders * (bundles[0]?.cogs ?? 0);
  return rev - spend - cogs - rev * (t.fee_pct ?? 0) - orders * (t.fee_fixed ?? 0);
}

