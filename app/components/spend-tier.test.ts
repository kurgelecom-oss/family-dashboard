/* Boundary proof for spendTier(). Run with `npm test` — Node's built-in runner,
   no framework: the whole point of splitting this helper out of PanelFinance was
   that the bands could be checked without rendering a card. */

import test from "node:test";
import assert from "node:assert/strict";
// Extension included on purpose: `npm test` runs this through Node's own ESM
// loader, which does not resolve extensionless specifiers the way the bundler
// does. `allowImportingTsExtensions` in tsconfig keeps tsc happy with it.
import { spendTier } from "./spend-tier.ts";

/* The six specified cuts, plus the cases that decide what happens between
   them and what a sign flip does. */
const CASES: [number, number][] = [
  // ── the specified boundaries ──
  [1200, 0],
  [1201, 1],
  [1400, 1],
  [1401, 2],
  [1598, 2],
  [1599, 3],
  // ── cents in the gaps ──
  [1200.5, 1],
  [1598.4, 2],
  // ── ends and edges ──
  [0, 0],
  [-1700, 3],
  [99999, 3],
  [Number.NaN, 0],
];

for (const [amount, expected] of CASES) {
  test(`${amount} → tier ${expected}`, () => {
    assert.equal(spendTier(amount), expected);
  });
}
