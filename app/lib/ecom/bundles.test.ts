import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FEES, blended} from './shopify-fees.ts';
import {TIERS} from './tiers.ts';
import {costFor, costPerUnit, slope, cpaSlope, solvePrice, ladder, blend,
 normaliseMix, mixAtMultiShare, multiShareNeeded, supplierVolumeDiscount, returnRate,
 marginalCost, cpaFundedPrice, type SupplierCosts} from './bundles.ts';

const near=(a:number,b:number,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} !~ ${b}`);

/* The real quote this model was built from: Doctea Joint & Muscle Support,
   US, four pack sizes, Total already including freight. */
const SC:SupplierCosts = {
 totals:[7.40, 10.40, 13.90, 17.70],
 extraPerOrder:0, retPct:8, retLossPct:25, gstPct:10, keepPct:20, fees:DEFAULT_FEES,
};
const EXC = TIERS[0].before;   // 0.65 before ads

test('the supplier total is used as quoted, not multiplied out',()=>{
 const fixed = blended(SC.fees).fixed;
 near(costFor(1,SC), 7.40+fixed);
 near(costFor(2,SC), 10.40+fixed);
 near(costFor(3,SC), 13.90+fixed);
 near(costFor(4,SC), 17.70+fixed);
 // The trap this model exists to avoid: two units are NOT twice one.
 assert.ok(SC.totals[1] < SC.totals[0]*2, '$10.40 is well under $14.80');
 assert.ok(SC.totals[3] < SC.totals[0]*4, '$17.70 is well under $29.60');
});

test('a pack size the supplier did not quote falls back to the largest',()=>{
 near(costFor(9,SC), costFor(4,SC));
 near(costPerUnit(4,SC), 17.70/4);
});

test('the supplier hands over a volume discount before you discount anything',()=>{
 near(costPerUnit(1,SC), 7.40);
 near(costPerUnit(4,SC), 4.425);
 const d = supplierVolumeDiscount(SC);
 assert.ok(d>0.38 && d<0.42, `expected ~40% volume discount, got ${(d*100).toFixed(1)}%`);
 // Per-unit cost must fall monotonically across a sane quote.
 for(let u=2;u<=4;u++) assert.ok(costPerUnit(u,SC) < costPerUnit(u-1,SC));
});

test('extraPerOrder is additive and defaults to nothing, so freight is not double counted',()=>{
 near(costFor(1,SC) + 2.5, costFor(1,{...SC,extraPerOrder:2.5}));
 // With the default the only addition to the quote is the flat Shopify cent.
 near(costFor(1,SC) - SC.totals[0], blended(SC.fees).fixed);
});

test('each pack price is solved to the same before-ads target',()=>{
 const rows = ladder(EXC, SC);
 for(const r of rows){
  assert.ok(isFinite(r.price), `buy-${r.units} should be reachable`);
  near(r.before/r.netRev, EXC, 1e-9);
 }
 // Solved prices rise with pack size but per-unit prices fall.
 for(let i=1;i<rows.length;i++){
  assert.ok(rows[i].price > rows[i-1].price);
  assert.ok(rows[i].pricePerUnit < rows[i-1].pricePerUnit);
 }
});

test('the discount is an output, derived from the solved price',()=>{
 const rows = ladder(EXC, SC);
 near(rows[0].impliedDisc, 0, 1e-9);            // the single is the baseline
 for(let i=1;i<rows.length;i++){
  const r = rows[i];
  near(r.price, rows[0].price*r.units*(1-r.impliedDisc), 1e-9);
  assert.ok(r.impliedDisc > 0, `buy-${r.units} should imply a real offer`);
 }
 // Deeper packs imply deeper offers, because the supplier total flattens.
 assert.ok(rows[3].impliedDisc > rows[2].impliedDisc);
 assert.ok(rows[2].impliedDisc > rows[1].impliedDisc);
});

test('target CPA rises with pack size even though per-unit price falls',()=>{
 const rows = ladder(EXC, SC);
 for(let i=1;i<rows.length;i++) assert.ok(rows[i].targetCpa > rows[i-1].targetCpa);
 near(rows[0].headroom, 1, 1e-9);
 assert.ok(rows[3].headroom > 2, `buy-4 headroom was ${rows[3].headroom}`);
});

test('break-even CPA is everything left before ads, and target keeps the margin',()=>{
 const rows = ladder(EXC, SC);
 for(const r of rows){
  near(r.breakEvenCpa, r.before);
  near(r.before, r.netRev - r.cost - r.fee - r.returns, 1e-9);
  near(r.breakEvenCpa - r.targetCpa, SC.keepPct/100*r.netRev, 1e-9);
 }
});

test('maxDisc is the exact point a pack stops beating a single sale',()=>{
 const rows = ladder(EXC, SC);
 const single = rows[0];
 for(const r of rows.slice(1)){
  assert.ok(isFinite(r.maxDisc) && r.maxDisc>r.impliedDisc,
    `buy-${r.units} should have room below its solved price`);
  // Price it at exactly maxDisc off the single-unit list and it ties.
  const list = single.price*r.units;
  const tied = list*(1-r.maxDisc);
  const net = tied/1.1;
  const f = blended(SC.fees);
  const t = net - r.cost - (tied*f.pct/100+f.fixed) - returnRate(SC)*net - SC.keepPct/100*net;
  near(t, single.targetCpa, 1e-6);
 }
});

test('the paid CPA decides which packs are usable, and the single often is not',()=>{
 const rows = ladder(EXC, SC, 25);
 assert.ok(!rows[0].fundsCpa, 'a single bottle cannot fund a $25 CPA here');
 assert.ok(rows[3].fundsCpa, 'the four-pack can');
 // With no CPA supplied there is nothing to judge.
 assert.ok(ladder(EXC, SC, 0).every(r=>r.fundsCpa));
});

test('a tighter tier needs a higher price and leaves more per order',()=>{
 const exc = ladder(TIERS[0].before, SC)[0];
 const poor = ladder(TIERS[3].before, SC)[0];
 assert.ok(exc.price > poor.price);
 assert.ok(exc.targetCpa > poor.targetCpa);
});

test('an impossible cost base reports unreachable rather than a negative price',()=>{
 const hopeless:SupplierCosts = {...SC, retPct:95, retLossPct:95};
 assert.ok(slope(EXC, hopeless) <= 0);
 assert.equal(solvePrice(EXC, 1, hopeless), Infinity);
 const rows = ladder(EXC, hopeless);
 assert.ok(rows.every(r=>r.unreachable));
 assert.ok(rows.every(r=>!isFinite(r.price)));
});

test('a quote with fewer rows still produces a ladder',()=>{
 const two:SupplierCosts = {...SC, totals:[7.40, 10.40]};
 const rows = ladder(EXC, two);
 assert.equal(rows.length, 2);
 assert.ok(Number.isNaN(supplierVolumeDiscount({...SC, totals:[7.40]})));
});

/* ── the blend ─────────────────────────────────────────────────────────── */

test('a mix is normalised, and an empty mix means all singles',()=>{
 near(normaliseMix([60,25,10,5],4).reduce((a,b)=>a+b,0), 1);
 const empty = normaliseMix([0,0,0,0],4);
 near(empty[0],1); near(empty[1],0);
});

test('the blend is the take-rate-weighted average, per order',()=>{
 const rows = ladder(EXC, SC);
 const b = blend(rows,[60,25,10,5])!;
 const w = [0.60,0.25,0.10,0.05];
 near(b.unitsPerOrder, 1*w[0]+2*w[1]+3*w[2]+4*w[3]);
 near(b.aov, rows.reduce((a,r,i)=>a+w[i]*r.price,0), 1e-9);
 near(b.targetCpa, rows.reduce((a,r,i)=>a+w[i]*r.targetCpa,0), 1e-9);
 near(b.costPerOrder, rows.reduce((a,r,i)=>a+w[i]*r.cost,0), 1e-9);
 near(b.multiShare, 0.40);
});

test('an all-singles mix is identical to having no bundles',()=>{
 const rows = ladder(EXC, SC);
 const b = blend(rows,[1,0,0,0])!;
 near(b.targetCpa, rows[0].targetCpa, 1e-9);
 near(b.upliftVsSingle, 1, 1e-9);
 near(b.unitsPerOrder, 1);
});

test('take rate is what decides whether bundles matter',()=>{
 const rows = ladder(EXC, SC);
 const thin = blend(rows, mixAtMultiShare(rows,[60,25,10,5],0.10))!;
 const fat  = blend(rows, mixAtMultiShare(rows,[60,25,10,5],0.70))!;
 assert.ok(fat.targetCpa > thin.targetCpa);
 assert.ok(fat.unitsPerOrder > thin.unitsPerOrder);
 near(thin.multiShare, 0.10, 1e-9);
 near(fat.multiShare, 0.70, 1e-9);
});

test('mixAtMultiShare keeps the shape among the multi rows',()=>{
 const rows = ladder(EXC, SC);
 const m = mixAtMultiShare(rows,[60,25,10,5],0.5);
 near(m[0],0.5);
 near(m[1]+m[2]+m[3],0.5,1e-9);
 near(m[1]/m[2], 25/10, 1e-9);
});

test('the blend can fund a CPA no single pack can, and refuses when none can',()=>{
 const rows = ladder(EXC, SC, 25);
 // A CPA the single misses but the mix can reach.
 const need = multiShareNeeded(rows,[60,25,10,5],14);
 assert.ok(need!==null && need>0, `a real take rate should be required, got ${need}`);
 assert.ok(rows[0].targetCpa < 14, 'the single must be the one that falls short');
 const at = blend(rows, mixAtMultiShare(rows,[60,25,10,5],need!))!;
 assert.ok(at.targetCpa >= 14);
 const below = blend(rows, mixAtMultiShare(rows,[60,25,10,5],Math.max(need!-0.02,0)))!;
 assert.ok(below.targetCpa < 14);
 /* $25 is beyond even an all-multi mix at this tier, and the honest answer is
    null rather than a share above 100%. This is the real finding on a $7.40
    product: a 65% margin tier prices it too low to buy traffic at $25. */
 assert.equal(multiShareNeeded(rows,[60,25,10,5],25), null);
});

test('the CPA-funded price is the other constraint, and it binds on cheap goods',()=>{
 const rows = ladder(EXC, SC, 25);
 // The tier price cannot carry the CPA, so the CPA-funded price sits above it.
 assert.ok(rows[0].cpaFundedPrice > rows[0].price,
   `tier price ${rows[0].price} should be under the CPA-funded ${rows[0].cpaFundedPrice}`);
 // At that price the pack funds the CPA exactly and keeps the margin.
 const A = cpaSlope(SC);
 near(rows[0].cpaFundedPrice*A - costFor(1,SC), 25, 1e-6);
 // No CPA to fund means no premium over cost.
 near(cpaFundedPrice(1,SC,0)*A - costFor(1,SC), 0, 1e-6);
});

test('marginal cost is what each extra unit really adds',()=>{
 near(marginalCost(2,SC), 10.40-7.40);
 near(marginalCost(3,SC), 13.90-10.40);
 near(marginalCost(4,SC), 17.70-13.90);
 assert.ok(Number.isNaN(marginalCost(1,SC)));
 // Every extra unit costs a fraction of the first, which is the whole case
 // for bundling on a quote shaped like this.
 for(let u=2;u<=4;u++) assert.ok(marginalCost(u,SC) < SC.totals[0]*0.6);
});

test('the slope and cost helpers agree with the full row maths',()=>{
 const A = cpaSlope(SC);
 const rows = ladder(EXC, SC);
 for(const r of rows) near(r.targetCpa, r.price*A - costFor(r.units,SC), 1e-9);
});
