import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FEES} from './shopify-fees.ts';
import {rung, TIERS, type Costs} from './tiers.ts';
import {bundle, bundleLadder, blend, normaliseMix, mixAtMultiShare, multiShareNeeded,
 cpaSlope, fixedCosts, DEFAULT_LADDER, DEFAULT_SHIP_PER_EXTRA, type BundleCosts} from './bundles.ts';

const near=(a:number,b:number,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} !~ ${b}`);

const COSTS:Costs = {cogs:12, ship:7, retPct:8, retLossPct:25, gstPct:10, fees:DEFAULT_FEES, keepPct:20};
const BC:BundleCosts = {...COSTS, shipPerExtra:DEFAULT_SHIP_PER_EXTRA};
const UNIT = rung(TIERS[0], COSTS).price;            // Excellent one-pack, $68.89
const SINGLE_TARGET = rung(TIERS[0], COSTS).targetCpa;

test('a one-pack through the bundle model matches the single-unit ladder',()=>{
 const b = bundle({unitPrice:UNIT, units:1, discPct:0}, BC, SINGLE_TARGET);
 const r = rung(TIERS[0], COSTS);
 near(b.price, r.price, 1e-9);
 near(b.targetCpa, r.targetCpa, 1e-9);
 near(b.before, r.before, 1e-9);
 // The bundle axis must not quietly change single-unit economics.
 near(b.headroomVsSingle, 1, 1e-9);
});

test('an extra unit multiplies product cost but not the order costs',()=>{
 const one = bundle({unitPrice:UNIT, units:1, discPct:0}, BC, SINGLE_TARGET);
 const two = bundle({unitPrice:UNIT, units:2, discPct:0}, BC, SINGLE_TARGET);
 near(two.cogs, one.cogs*2);                          // product scales
 near(two.ship, one.ship + DEFAULT_SHIP_PER_EXTRA);   // shipping does not
 // One order means one fixed transaction fee, not two.
 assert.ok(two.fee < one.fee*2, 'the flat per-transaction cent is paid once');
});

test('the headline claim: ~80% of a bundle is the CPA you do not pay again',()=>{
 const four = bundle({unitPrice:UNIT, units:4, discPct:0}, BC, SINGLE_TARGET);
 const one  = bundle({unitPrice:UNIT, units:1, discPct:0}, BC, SINGLE_TARGET);
 /* Only what the bundle genuinely avoids: three parcel bases and three flat
    transaction cents. The percentage fee is not a saving - four full-price
    orders pay more of it only because they total more money. */
 const shipAndFeeSaved = (one.ship*4 - four.ship) + 0.30*3;
 const cpaSaved = SINGLE_TARGET*3;                    // three customers not re-bought
 assert.ok(cpaSaved > shipAndFeeSaved*3,
   `CPA saving ${cpaSaved.toFixed(2)} should dominate ${shipAndFeeSaved.toFixed(2)}`);
 const share = cpaSaved/(cpaSaved+shipAndFeeSaved);
 assert.ok(share > 0.7 && share < 0.95, `acquisition share was ${(share*100).toFixed(0)}%`);
});

test('discounting a bundle reduces its headroom monotonically',()=>{
 let last = Infinity;
 for(const d of [0,10,20,30,40]){
  const b = bundle({unitPrice:UNIT, units:3, discPct:d}, BC, SINGLE_TARGET);
  assert.ok(b.targetCpa < last, `discount ${d}% should not raise target CPA`);
  last = b.targetCpa;
 }
});

test('maxDiscount is the exact point where a bundle stops beating the single',()=>{
 for(const u of [2,3,4]){
  const probe = bundle({unitPrice:UNIT, units:u, discPct:0}, BC, SINGLE_TARGET);
  const d = probe.maxDiscount;
  assert.ok(isFinite(d) && d>0 && d<1, `buy-${u} maxDiscount looked wrong: ${d}`);
  // At exactly that discount the bundle ties the one-pack.
  const at = bundle({unitPrice:UNIT, units:u, discPct:d*100}, BC, SINGLE_TARGET);
  near(at.targetCpa, SINGLE_TARGET, 1e-6);
  // A hair deeper and it is worse than selling one.
  const past = bundle({unitPrice:UNIT, units:u, discPct:d*100+1}, BC, SINGLE_TARGET);
  assert.ok(past.targetCpa < SINGLE_TARGET);
 }
});

test('bigger bundles can carry deeper discounts',()=>{
 const d2 = bundle({unitPrice:UNIT, units:2, discPct:0}, BC, SINGLE_TARGET).maxDiscount;
 const d3 = bundle({unitPrice:UNIT, units:3, discPct:0}, BC, SINGLE_TARGET).maxDiscount;
 const d4 = bundle({unitPrice:UNIT, units:4, discPct:0}, BC, SINGLE_TARGET).maxDiscount;
 assert.ok(d3 > d2 && d4 > d3, `expected rising room, got ${d2}, ${d3}, ${d4}`);
});

test('the shipping increment is the input that flatters bundles, and it bites',()=>{
 const cheap = bundle({unitPrice:UNIT, units:4, discPct:25}, {...BC, shipPerExtra:1.5}, SINGLE_TARGET);
 const real  = bundle({unitPrice:UNIT, units:4, discPct:25}, {...BC, shipPerExtra:4.0}, SINGLE_TARGET);
 assert.ok(real.targetCpa < cheap.targetCpa);
 // Three extra units at $2.50 more each is $7.50 straight off the headroom.
 near(cheap.targetCpa - real.targetCpa, 2.5*3, 1e-6);
 assert.ok(real.maxDiscount < cheap.maxDiscount);
});

test('landed-cost share decides the discount, not what competitors advertise',()=>{
 // Low COGS share: a supplement-shaped product.
 const lowCosts:BundleCosts = {...BC, cogs:6};
 const lowUnit = rung(TIERS[0], {...COSTS, cogs:6}).price;
 const lowSingle = rung(TIERS[0], {...COSTS, cogs:6}).targetCpa;
 const low = bundle({unitPrice:lowUnit, units:3, discPct:30}, lowCosts, lowSingle);

 // High COGS share: an electronics-shaped product priced on a thin margin.
 const highCosts:BundleCosts = {...BC, cogs:40};
 const highUnit = rung(TIERS[3], {...COSTS, cogs:40}).price;   // Poor tier, thin
 const highSingle = rung(TIERS[3], {...COSTS, cogs:40}).targetCpa;
 const high = bundle({unitPrice:highUnit, units:3, discPct:30}, highCosts, highSingle);

 // Same advertised offer - 3-pack, 30% off - opposite verdicts.
 assert.ok(low.targetCpa > lowSingle, 'low-COGS product gains from the offer');
 assert.ok(high.targetCpa < highSingle, 'high-COGS product loses from the same offer');
 assert.ok(low.maxDiscount > high.maxDiscount);
});

/* ── the blend ─────────────────────────────────────────────────────────── */

test('a mix is normalised, and an empty mix means all singles rather than a crash',()=>{
 near(normaliseMix([60,25,10,5],4).reduce((a,b)=>a+b,0), 1);
 const empty = normaliseMix([0,0,0,0],4);
 near(empty[0],1); near(empty[1],0);
});

test('the blend is the take-rate-weighted average, per order',()=>{
 const rows = bundleLadder(UNIT, BC, DEFAULT_LADDER);
 const b = blend(rows, [60,25,10,5]);
 const w = [0.60,0.25,0.10,0.05];
 near(b.unitsPerOrder, 1*w[0]+2*w[1]+3*w[2]+4*w[3]);
 near(b.aov, rows.reduce((a,r,i)=>a+w[i]*r.price,0), 1e-9);
 near(b.targetCpa, rows.reduce((a,r,i)=>a+w[i]*r.targetCpa,0), 1e-9);
 near(b.multiShare, 0.40);
});

test('an all-singles mix is economically identical to having no bundles',()=>{
 const rows = bundleLadder(UNIT, BC, DEFAULT_LADDER);
 const b = blend(rows, [1,0,0,0]);
 near(b.targetCpa, SINGLE_TARGET, 1e-9);
 near(b.upliftVsSingle, 1, 1e-9);
 near(b.unitsPerOrder, 1);
});

test('take rate is what decides whether bundles matter at all',()=>{
 const rows = bundleLadder(UNIT, BC, DEFAULT_LADDER);
 const thin = blend(rows, mixAtMultiShare(rows, [60,25,10,5], 0.10));
 const fat  = blend(rows, mixAtMultiShare(rows, [60,25,10,5], 0.60));
 assert.ok(fat.targetCpa > thin.targetCpa);
 assert.ok(fat.unitsPerOrder > thin.unitsPerOrder);
 near(thin.multiShare, 0.10, 1e-9);
 near(fat.multiShare, 0.60, 1e-9);
});

test('mixAtMultiShare keeps the shape among the multi rows',()=>{
 const rows = bundleLadder(UNIT, BC, DEFAULT_LADDER);
 const m = mixAtMultiShare(rows, [60,25,10,5], 0.5);
 near(m[0], 0.5);
 near(m[1]+m[2]+m[3], 0.5, 1e-9);
 // 25:10:5 preserved inside the multi half.
 near(m[1]/m[2], 25/10, 1e-9);
 near(m[2]/m[3], 10/5, 1e-9);
});

test('the take rate needed to fund a CPA is reported, or honestly refused',()=>{
 const rows = bundleLadder(UNIT, BC, DEFAULT_LADDER);
 const reachable = multiShareNeeded(rows, [60,25,10,5], SINGLE_TARGET*1.5);
 assert.ok(reachable!==null && reachable>0 && reachable<=1, `got ${reachable}`);
 near(blend(rows, mixAtMultiShare(rows,[60,25,10,5],reachable!)).targetCpa >= SINGLE_TARGET*1.5 ? 1:0, 1);
 // A CPA no mix can fund returns null, not a share above 100%.
 assert.equal(multiShareNeeded(rows, [60,25,10,5], 1e6), null);
});

test('fundsCpa marks the rungs that cover the CPA actually paid',()=>{
 const rows = bundleLadder(UNIT, BC, DEFAULT_LADDER, 40);
 assert.ok(!rows[0].fundsCpa, 'the one-pack cannot fund $40 here');
 assert.ok(rows[3].fundsCpa, 'the four-pack can');
 // With no CPA supplied there is no judgement to make.
 assert.ok(bundleLadder(UNIT, BC, DEFAULT_LADDER, 0).every(r=>r.fundsCpa));
});

test('the slope and fixed-cost helpers agree with the full model',()=>{
 const A = cpaSlope(BC);
 for(const u of [1,2,3,4]){
  const b = bundle({unitPrice:UNIT, units:u, discPct:12}, BC, SINGLE_TARGET);
  near(b.targetCpa, b.price*A - fixedCosts(u,BC), 1e-9);
 }
});

test('an impossible cost base yields no discount room rather than a fantasy',()=>{
 const hopeless:BundleCosts = {...BC, retPct:95, retLossPct:95};
 assert.ok(cpaSlope(hopeless) <= 0);
 const b = bundle({unitPrice:UNIT, units:3, discPct:0}, hopeless, SINGLE_TARGET);
 assert.ok(Number.isNaN(b.maxDiscount));
 assert.ok(b.targetCpa < 0);
});
