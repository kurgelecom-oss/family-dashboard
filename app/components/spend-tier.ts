/* ════════════════════════════════════════════════════════════════════════════
   Weekly spend → threshold tier.

   Pure, no React, no DOM: the only thing this decides is which of the four
   `.spend-tier-*` classes in globals.css the weekly hero figure wears. The
   colour, the glow and the scale all live in CSS; this file owns the numbers
   and nothing else, so the boundaries can be checked without rendering.

   Bands are on the ABSOLUTE value in AUD — a spend figure arrives positive from
   PocketSmith, but a sign flip upstream must not silently drop a $1,700 week
   into the calm green band.

   The named boundaries are exact and load-bearing:
     1200 → 0   1201 → 1   1400 → 1   1401 → 2   1598 → 2   1599 → 3
   The bands were specified on whole dollars, so the cuts are written as the
   ranges those integers imply — `<= 1200`, `<= 1400`, `< 1599` — and cents in
   the gaps land on the side of the cut they fall on: 1598.40 is still tier 2,
   1200.50 is already tier 1.
   ══════════════════════════════════════════════════════════════════════════ */

export type SpendTier = 0 | 1 | 2 | 3;

/** Cut points, in AUD. Kept adjacent to the function so they read as one unit. */
const CALM_MAX = 1200;
const WATCH_MAX = 1400;
const HOT_LIMIT = 1599;

export function spendTier(amount: number): SpendTier {
  // A non-finite figure is a broken payload, not a calm week — but the panel
  // already refuses to render on a bad shape, so the safe read here is the
  // quiet one rather than a false alarm on garbage.
  if (!Number.isFinite(amount)) return 0;

  const spend = Math.abs(amount);
  if (spend <= CALM_MAX) return 0;
  if (spend <= WATCH_MAX) return 1;
  if (spend < HOT_LIMIT) return 2;
  return 3;
}

/** Class pair for the hero figure: the base rule plus its tier. */
export function spendTierClass(amount: number): string {
  return `spend-tier spend-tier-${spendTier(amount)}`;
}
