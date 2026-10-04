/* Bundles: buy-1, buy-2, buy-3, buy-4 of the SAME SKU.

   The point of a bundle is not cheaper fulfilment. It is not buying the
   customer again. On a four-pack the saving against four separate orders is
   about $17 of shipping and fixed fees against $75 of CPA - roughly 80% of
   the advantage is the acquisition cost you never pay.

   So this module asks two questions the single-unit ladder cannot:

     1. How deep can each bundle be discounted before that advantage is
        spent? (`maxDiscount` - solved, not guessed.)
     2. What does the real take-rate mix do to the ONE break-even CPA you
        judge ads against? (`blend` - because CPA is charged per order, and
        every order is one of these four bundles.)

   Bundle size is a second axis, not three more rungs on the quality ladder.
   The quality tier sets the single-unit price; the bundle axis multiplies it. */

import {blended as blendedFee} from './shopify-fees.ts';
import {returnRate, type Costs} from './tiers.ts';

export type BundleInput = {
 /** The one-pack retail price, GST inclusive. Comes from the chosen quality rung. */
 unitPrice:number;
 /** Units in the bundle. 1 is the plain single. */
 units:number;
 /** Discount off `units x unitPrice`, percent. */
 discPct:number;
};

/** Costs, plus the one thing single-unit economics never needed: what each
    EXTRA unit adds to the parcel. Modelling this as zero is the fastest way
    to make every bundle look better than it is - a four-pack crosses weight
    breaks and needs a bigger box. */
export type BundleCosts = Costs & {shipPerExtra:number};

export const DEFAULT_SHIP_PER_EXTRA = 1.5;

const clamp = (v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));

/** Price-slope of target CPA: how much of each retail dollar survives GST,
    fees, returns and the margin you keep. Shared by the model and the
    solver so they cannot drift apart. */
export function cpaSlope(c:BundleCosts){
 const g = clamp(c.gstPct,0,100)/100;
 const f = blendedFee(c.fees);
 return (1 - returnRate(c) - clamp(c.keepPct,0,100)/100)/(1 + g) - f.pct/100;
}

/** Order-level costs that do NOT scale with the retail price. */
export function fixedCosts(units:number, c:BundleCosts){
 const f = blendedFee(c.fees);
 const u = Math.max(Math.round(units),1);
 return c.cogs*u + c.ship + c.shipPerExtra*(u-1) + f.fixed;
}

export type Bundle = {
 units:number;
 discPct:number;
 /** What the customer pays for the bundle, GST inclusive. */
 price:number;
 pricePerUnit:number;
 netRev:number;
 gst:number;
 fee:number;
 cogs:number;
 ship:number;
 returns:number;
 /** Everything left before advertising. The break-even CPA for this bundle. */
 before:number;
 breakEvenCpa:number;
 targetCpa:number;
 /** Per unit, so a bundle can be compared with the single on equal terms. */
 beforePerUnit:number;
 /** Target CPA against the one-pack's, as a ratio. 2.0 = twice the headroom. */
 headroomVsSingle:number;
 /** Deepest discount that still beats the one-pack's target CPA. */
 maxDiscount:number;
 /** True when this bundle funds the CPA actually being paid. */
 fundsCpa:boolean;
};

export function bundle(input:BundleInput, c:BundleCosts, singleTargetCpa:number, actualCpa = 0): Bundle {
 const g = clamp(c.gstPct,0,100)/100;
 const u = Math.max(Math.round(input.units),1);
 const f = blendedFee(c.fees);

 const list = input.unitPrice * u;
 const price = list * (1 - clamp(input.discPct,0,100)/100);
 const netRev = price/(1+g);
 const gst = price - netRev;
 const fee = price>0 ? price*f.pct/100 + f.fixed : 0;
 const cogs = c.cogs*u;
 const ship = c.ship + c.shipPerExtra*(u-1);
 const returns = returnRate(c) * netRev;
 const before = netRev - cogs - ship - fee - returns;
 const targetCpa = before - clamp(c.keepPct,0,100)/100 * netRev;

 /* targetCpa = P*A - C, so the price that hits a given target is
    P = (T + C)/A and the discount is 1 - P/list. A non-positive slope means
    no price works at all, let alone a discounted one. */
 const A = cpaSlope(c);
 const C = fixedCosts(u, c);
 let maxDiscount = NaN;
 if(A > 0 && list > 0){
  maxDiscount = 1 - (singleTargetCpa + C)/(A*list);
 }

 return {
  units:u, discPct:input.discPct, price, pricePerUnit: price/u,
  netRev, gst, fee, cogs, ship, returns,
  before, breakEvenCpa: before, targetCpa,
  beforePerUnit: before/u,
  headroomVsSingle: singleTargetCpa>0 ? targetCpa/singleTargetCpa : NaN,
  maxDiscount,
  fundsCpa: actualCpa<=0 ? true : targetCpa >= actualCpa,
 };
}

/** Default bundle sizes and the discounts operators typically advertise.
    The discounts are a starting point, not a recommendation: `maxDiscount`
    on each rung says how far each one can actually go. */
export const DEFAULT_LADDER:{units:number; discPct:number}[] = [
 {units:1, discPct:0},
 {units:2, discPct:10},
 {units:3, discPct:20},
 {units:4, discPct:25},
];

export function bundleLadder(
 unitPrice:number, c:BundleCosts,
 rows = DEFAULT_LADDER, actualCpa = 0,
): Bundle[] {
 // The one-pack at full price is the benchmark every other rung is judged on.
 const single = bundle({unitPrice, units:1, discPct:0}, c, 1, actualCpa);
 const singleTarget = single.targetCpa;
 return rows.map(r => bundle({unitPrice, units:r.units, discPct:r.discPct}, c, singleTarget, actualCpa));
}

/* ── the blend ─────────────────────────────────────────────────────────────
   CPA is charged per ORDER, and every order is one of these bundles. So the
   number that decides whether you can scale is the take-rate-weighted
   average, never any single rung. A ladder where 80% take the one-pack is
   economically almost identical to having no bundles at all. */

export type Mix = number[];   // take rate per ladder row, any scale

export type Blend = {
 weights:number[];
 unitsPerOrder:number;
 aov:number;
 cogsPerOrder:number;
 /** Blended break-even CPA: the single number to hold ads to. */
 breakEvenCpa:number;
 targetCpa:number;
 /** Blended target CPA against the one-pack's. The whole case for bundling. */
 upliftVsSingle:number;
 /** Share of orders taking more than one unit. */
 multiShare:number;
};

export function normaliseMix(mix:Mix, n:number): number[] {
 const m = Array.from({length:n}, (_,i)=> Math.max(mix[i] ?? 0, 0));
 const t = m.reduce((a,b)=>a+b,0);
 if(!(t>0)) return m.map((_,i)=> i===0 ? 1 : 0);   // all singles, not a crash
 return m.map(v=>v/t);
}

export function blend(rows:Bundle[], mix:Mix): Blend {
 const w = normaliseMix(mix, rows.length);
 const sum = (f:(b:Bundle,i:number)=>number) => rows.reduce((a,b,i)=> a + w[i]*f(b,i), 0);
 const single = rows.find(r=>r.units===1 && r.discPct===0) ?? rows[0];
 const targetCpa = sum(b=>b.targetCpa);
 return {
  weights:w,
  unitsPerOrder: sum(b=>b.units),
  aov: sum(b=>b.price),
  cogsPerOrder: sum(b=>b.cogs),
  breakEvenCpa: sum(b=>b.before),
  targetCpa,
  upliftVsSingle: single.targetCpa>0 ? targetCpa/single.targetCpa : NaN,
  multiShare: rows.reduce((a,b,i)=> a + (b.units>1 ? w[i] : 0), 0),
 };
}

/** Re-weight a mix so a given share of orders takes more than one unit,
    preserving the relative shape among the multi rows. Drives the
    sensitivity curve: "what take rate do I need for this to work?" */
export function mixAtMultiShare(rows:Bundle[], shape:Mix, multiShare:number): number[] {
 const s = clamp(multiShare,0,1);
 const idx = rows.map((r,i)=>({r,i}));
 const multi = idx.filter(x=>x.r.units>1);
 const shapeTotal = multi.reduce((a,x)=> a + Math.max(shape[x.i] ?? 0, 0), 0);
 return rows.map((r,i)=>{
  if(r.units<=1) return 1-s;
  if(!(shapeTotal>0)) return s/multi.length;
  return s * Math.max(shape[i] ?? 0, 0)/shapeTotal;
 });
}

/** Take rate needed for the blended target CPA to reach `cpa`. Returns null
    when even an all-multi mix cannot get there, so callers say "never"
    instead of printing a share above 100%. */
export function multiShareNeeded(rows:Bundle[], shape:Mix, cpa:number): number | null {
 for(let i=0;i<=100;i++){
  const s = i/100;
  if(blend(rows, mixAtMultiShare(rows, shape, s)).targetCpa >= cpa) return s;
 }
 return null;
}
