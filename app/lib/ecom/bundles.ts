/* Bundles, modelled the way suppliers actually quote them.

   A supplier quote arrives as a table with one row per pack size and a Total
   column that already folds freight in:

       PCS   Cost    Freight   Total
        1    $2.40   $5.00     $7.40
        2    $4.50   $5.90     $10.40
        3    $6.60   $7.30     $13.90
        4    $8.70   $9.00     $17.70

   Two things follow, and both were wrong in the earlier single-unit model.

   1. The totals are NOT linear. Two units cost $10.40, not $14.80. The
      supplier has already priced in the freight economy of scale, so a
      per-unit cost multiplied by quantity overstates every bundle. The
      implied per-unit cost here falls from $7.40 to $4.43 across the table -
      a 40% volume discount the operator gets for free.

   2. The Total already includes delivery. A separate shipping field would
      double-count it, which is why `extraPerOrder` below defaults to zero and
      means only what the supplier total does NOT cover: your own packaging,
      pick-and-pack labour, insert cards.

   And because there is now a cost for every pack size, the retail price of
   each bundle is SOLVED rather than guessed. The operator no longer enters a
   discount; the engine reports the discount its solved price implies. */

import {blended as blendedFee, type FeeConfig} from './shopify-fees.ts';

export type SupplierCosts = {
 /** Landed, delivered total per pack size. Index 0 is one unit. The supplier
     Total column, pasted straight in. */
 totals:number[];
 /** Per-order cost the supplier total does not cover. Zero when the quote is
     fully landed and delivered, which it usually is. */
 extraPerOrder:number;
 /** Share of orders returned, percent. */
 retPct:number;
 /** Share of an order's value lost when one comes back, percent. */
 retLossPct:number;
 /** GST rate percent, inside the retail price. */
 gstPct:number;
 /** Contribution margin to keep after ads, percent of net revenue. */
 keepPct:number;
 fees:FeeConfig;
};

const clamp = (v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));

export const returnRate = (sc:SupplierCosts) =>
 (clamp(sc.retPct,0,100)/100) * (clamp(sc.retLossPct,0,100)/100);

/** Every order-level cost that does not scale with the retail price, for a
    given pack size. Falls back to the largest quoted total when asked for a
    size the supplier did not quote. */
export function costFor(units:number, sc:SupplierCosts){
 const u = Math.max(Math.round(units),1);
 const t = sc.totals;
 const total = t.length ? (t[u-1] ?? t[t.length-1]) : 0;
 return Math.max(total,0) + Math.max(sc.extraPerOrder,0) + blendedFee(sc.fees).fixed;
}

/** Supplier cost per unit at a given pack size. Falling values here are the
    volume discount the supplier is already handing over. */
export function costPerUnit(units:number, sc:SupplierCosts){
 const u = Math.max(Math.round(units),1);
 const t = sc.totals;
 const total = t.length ? (t[u-1] ?? t[t.length-1]) : NaN;
 return total/u;
}

/** Share of each retail dollar left after GST, Shopify's percentage and the
    expected cost of returns, once `target` is set aside. With `target` as a
    tier's before-ads goal this solves price; with the margin to keep it gives
    the slope of target CPA. */
export function slope(target:number, sc:SupplierCosts){
 const g = clamp(sc.gstPct,0,100)/100;
 return (1 - returnRate(sc) - target)/(1 + g) - blendedFee(sc.fees).pct/100;
}
export const cpaSlope = (sc:SupplierCosts) => slope(clamp(sc.keepPct,0,100)/100, sc);

/** Retail price for a pack size that leaves `target` of net revenue before
    advertising. Infinity when the cost base makes the target unreachable at
    any price, so callers can say so instead of printing a negative. */
export function solvePrice(target:number, units:number, sc:SupplierCosts){
 const s = slope(target, sc);
 if(s <= 0) return Infinity;
 return costFor(units, sc)/s;
}

/** What the supplier charges for ONE more unit at this pack size. The real
    reason bundles work on a quote like this: unit two costs $3.00 more than
    unit one, so almost everything the customer pays for it is contribution. */
export function marginalCost(units:number, sc:SupplierCosts){
 const u = Math.max(Math.round(units),1);
 if(u<2) return NaN;
 const t = sc.totals;
 const hi = t[u-1] ?? t[t.length-1];
 const lo = t[u-2] ?? t[t.length-1];
 return hi-lo;
}

/** The retail price a pack must carry to fund `cpa` AND keep the margin.
    Solving a pack purely against a margin percentage gives the minimum viable
    price, not a price that can buy traffic: a cheap product hits 65% margin
    at a price far below what a customer would pay and far below what a CPA
    costs. This is the other constraint, and the higher of the two is the one
    that binds. */
export function cpaFundedPrice(units:number, sc:SupplierCosts, cpa:number){
 const A = cpaSlope(sc);
 if(A <= 0) return Infinity;
 return (costFor(units, sc) + Math.max(cpa,0))/A;
}

export type Row = {
 units:number;
 /** Solved retail price for this pack, GST inclusive. */
 price:number;
 pricePerUnit:number;
 /** Supplier's landed total for this pack, before your own extras. */
 supplierTotal:number;
 supplierPerUnit:number;
 /** What the solved price works out to as an offer off the single-unit price.
     This is the number that goes on the product page. */
 impliedDisc:number;
 netRev:number;
 gst:number;
 fee:number;
 cost:number;
 returns:number;
 /** Everything left before advertising. The break-even CPA for this pack. */
 before:number;
 breakEvenCpa:number;
 targetCpa:number;
 /** Target CPA against the single's, as a ratio. */
 headroom:number;
 /** How far below the solved price this pack can be cut before it earns less
     than selling one unit. */
 maxDisc:number;
 fundsCpa:boolean;
 unreachable:boolean;
 /** Supplier cost of the last unit added to this pack. */
 marginalCost:number;
 /** Price this pack would need to fund the CPA being paid. */
 cpaFundedPrice:number;
};

export function row(target:number, units:number, sc:SupplierCosts,
                    singlePrice:number, singleTarget:number, actualCpa = 0): Row {
 const u = Math.max(Math.round(units),1);
 const g = clamp(sc.gstPct,0,100)/100;
 const price = solvePrice(target, u, sc);
 const t = sc.totals;
 const supplierTotal = t.length ? (t[u-1] ?? t[t.length-1]) : NaN;

 if(!isFinite(price)){
  return {units:u, price:Infinity, pricePerUnit:Infinity, supplierTotal,
   supplierPerUnit:supplierTotal/u, impliedDisc:NaN, netRev:NaN, gst:NaN, fee:NaN,
   cost:NaN, returns:NaN, before:NaN, breakEvenCpa:NaN, targetCpa:NaN, headroom:NaN,
   maxDisc:NaN, fundsCpa:false, unreachable:true,
   marginalCost:marginalCost(u,sc), cpaFundedPrice:cpaFundedPrice(u,sc,actualCpa)};
 }

 const netRev = price/(1+g);
 const f = blendedFee(sc.fees);
 const fee = price*f.pct/100 + f.fixed;
 const cost = Math.max(supplierTotal,0) + Math.max(sc.extraPerOrder,0);
 const returns = returnRate(sc)*netRev;
 const before = netRev - cost - fee - returns;
 const targetCpa = before - clamp(sc.keepPct,0,100)/100*netRev;

 /* targetCpa = P*A - C. The price that ties the single is (T + C)/A, and the
    cut from the solved price down to it is the room this pack has. */
 const A = cpaSlope(sc);
 const C = costFor(u, sc);
 const list = singlePrice*u;
 let maxDisc = NaN;
 if(A > 0 && list > 0) maxDisc = 1 - (singleTarget + C)/(A*list);

 return {
  units:u, price, pricePerUnit:price/u,
  supplierTotal, supplierPerUnit:supplierTotal/u,
  impliedDisc: list>0 ? 1 - price/list : NaN,
  netRev, gst:price-netRev, fee, cost, returns,
  before, breakEvenCpa:before, targetCpa,
  headroom: singleTarget>0 ? targetCpa/singleTarget : NaN,
  maxDisc,
  fundsCpa: actualCpa<=0 ? true : targetCpa >= actualCpa,
  unreachable:false,
  marginalCost: marginalCost(u, sc),
  cpaFundedPrice: cpaFundedPrice(u, sc, actualCpa),
 };
}

/** One row per quoted pack size, all solved at the same before-ads target so
    the tier means the same thing across the ladder. */
export function ladder(target:number, sc:SupplierCosts, actualCpa = 0): Row[] {
 const n = Math.max(sc.totals.length, 1);
 const singlePrice = solvePrice(target, 1, sc);
 const single = row(target, 1, sc, isFinite(singlePrice)?singlePrice:1, 1, actualCpa);
 const singleTarget = single.targetCpa;
 return Array.from({length:n},(_,i)=>
   row(target, i+1, sc, singlePrice, singleTarget, actualCpa));
}

/* ── the blend ─────────────────────────────────────────────────────────────
   CPA is charged per ORDER and every order is one row of the ladder, so the
   only CPA worth judging ads against is the take-rate-weighted one. */

export type Blend = {
 weights:number[];
 unitsPerOrder:number;
 aov:number;
 costPerOrder:number;
 breakEvenCpa:number;
 targetCpa:number;
 upliftVsSingle:number;
 multiShare:number;
};

export function normaliseMix(mix:number[], n:number): number[] {
 const m = Array.from({length:n},(_,i)=> Math.max(mix[i] ?? 0, 0));
 const t = m.reduce((a,b)=>a+b,0);
 if(!(t>0)) return m.map((_,i)=> i===0 ? 1 : 0);
 return m.map(v=>v/t);
}

export function blend(rows:Row[], mix:number[]): Blend | null {
 if(!rows.length) return null;
 const w = normaliseMix(mix, rows.length);
 const sum = (f:(r:Row)=>number) => rows.reduce((a,r,i)=> a + w[i]*(isFinite(f(r))?f(r):0), 0);
 const targetCpa = sum(r=>r.targetCpa);
 return {
  weights:w,
  unitsPerOrder: sum(r=>r.units),
  aov: sum(r=>r.price),
  costPerOrder: sum(r=>r.cost),
  breakEvenCpa: sum(r=>r.before),
  targetCpa,
  upliftVsSingle: rows[0].targetCpa>0 ? targetCpa/rows[0].targetCpa : NaN,
  multiShare: rows.reduce((a,r,i)=> a + (r.units>1 ? w[i] : 0), 0),
 };
}

/** Re-weight so a given share of orders takes more than one unit, keeping the
    relative shape among the multi rows. Drives the sensitivity curve. */
export function mixAtMultiShare(rows:Row[], shape:number[], multiShare:number): number[] {
 const s = clamp(multiShare,0,1);
 const total = rows.reduce((a,r,i)=> a + (r.units>1 ? Math.max(shape[i] ?? 0,0) : 0), 0);
 const multiCount = rows.filter(r=>r.units>1).length || 1;
 return rows.map((r,i)=>{
  if(r.units<=1) return 1-s;
  if(!(total>0)) return s/multiCount;
  return s*Math.max(shape[i] ?? 0,0)/total;
 });
}

/** Take rate needed for the blended target CPA to reach `cpa`, or null when
    even an all-multi mix cannot get there. */
export function multiShareNeeded(rows:Row[], shape:number[], cpa:number): number | null {
 for(let i=0;i<=100;i++){
  const b = blend(rows, mixAtMultiShare(rows, shape, i/100));
  if(b && b.targetCpa >= cpa) return i/100;
 }
 return null;
}

/** The supplier's own volume discount: per-unit cost at the largest pack
    against the single. Free margin that arrives before you discount anything. */
export function supplierVolumeDiscount(sc:SupplierCosts){
 const n = sc.totals.length;
 if(n < 2) return NaN;
 const one = costPerUnit(1, sc), top = costPerUnit(n, sc);
 if(!(one>0)) return NaN;
 return 1 - top/one;
}
