/* COGS in, price ladder out.

   The one question this answers: given what a supplier charges me, what does
   the shelf price have to be for each quality of offer, and what is the most
   I can then pay for a customer.

   The tier is defined on CONTRIBUTION BEFORE ADS as a share of net revenue -
   the slice of every order that survives product, freight, fulfilment,
   Shopify's cut, GST and returns, and is therefore available to buy traffic
   and to keep. It is the only tier definition that COGS alone can drive, and
   it ties straight to the published benchmarks:

     median DTC contribution margin AFTER ads is 15-20%, top decile 28%+
     ad spend runs 20-30% of revenue
     => 20% kept + 25% ads = 45% before ads = an average offer
     => 28% kept + 27% ads = 55%+ before ads = a good one

   Price is solved, not guessed. Fees, GST and returns all scale with price,
   so a flat markup overshoots; the closed form below accounts for that. */

import {feeOn, blended, type FeeConfig, DEFAULT_FEES} from './shopify-fees.ts';

export type TierKey = 'excellent' | 'good' | 'average' | 'poor';

export type Tier = {key:TierKey; label:string; before:number; blurb:string};

/* `before` is the target contribution-before-ads margin, as a share of net
   revenue. Ordered best first so the UI can render the ladder top-down. */
export const TIERS: Tier[] = [
 {key:'excellent', label:'Excellent', before:0.65, blurb:'Room to outbid almost anyone and still keep a top-decile margin.'},
 {key:'good',      label:'Good',      before:0.55, blurb:'Can fund a competitive CPA and hold a 20%+ margin.'},
 {key:'average',   label:'Average',   before:0.45, blurb:'Works at a disciplined CPA. No room for a bad week.'},
 {key:'poor',      label:'Poor',      before:0.35, blurb:'Only survives on cheap traffic. One CPA rise kills it.'},
];

export type Costs = {
 /** Landed cost per unit, ex-GST: supplier invoice plus freight, duty, brokerage, inbound handling. */
 cogs:number;
 /** Net cost to get one order to the customer after whatever they pay toward it. */
 ship:number;
 /** Share of orders returned, percent. */
 retPct:number;
 /** Share of the order's value lost when one comes back, percent. */
 retLossPct:number;
 /** GST rate percent, 0 when not registered. Applies inside the retail price. */
 gstPct:number;
 fees:FeeConfig;
 /** Contribution margin to KEEP after advertising, percent of net revenue. */
 keepPct:number;
};

export const DEFAULT_COSTS: Costs = {
 // gstPct 0: the store operates without GST (tk, 5 Oct 2026).
 // retPct 0: no refund allowance is deducted (tk, 5 Oct 2026). The model still
 // supports one; it is simply off by default.
 cogs:12, ship:7, retPct:0, retLossPct:25, gstPct:0, fees:DEFAULT_FEES, keepPct:20,
};

/* What a cold Meta purchase is planned to cost, in USD, whatever the product.
   Landed cost sets the CPA an offer can AFFORD; it cannot set the CPA the
   auction CHARGES, so the affordable figure needs one outside number to be
   judged against. That number is the rulebook's planning CPA:
   mission-control-web/src/lib/radar/gates.json -> direct_path.planning_cpa_usd.
   The rulebook is the authority. If it changes, change this to match;
   tests/offer-model.test.mjs fails when the two drift on this Mac. */
export const TRAFFIC_FLOOR_CPA = 45;

const clamp = (v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));

/** Fraction of net revenue lost to expected returns. */
export const returnRate = (c:Costs) =>
 (clamp(c.retPct,0,100)/100) * (clamp(c.retLossPct,0,100)/100);

/** Retail price (what the customer is charged, GST included) that produces a
    contribution-before-ads margin of `target`.

    net = P/(1+g); fee = P*r + f; returns = k*net
    net - cogs - ship - fee - returns = target*net
    => P * [ (1-k-target)/(1+g) - r ] = cogs + ship + f

    A non-positive bracket means no price works: the variable rates plus the
    target already exceed every dollar coming in. Returns Infinity so callers
    surface "unreachable" instead of a negative price. */
export function priceFor(target:number, c:Costs = DEFAULT_COSTS){
 const g = clamp(c.gstPct,0,100)/100;
 const b = blended(c.fees);
 const r = b.pct/100;
 const k = returnRate(c);
 const bracket = (1 - k - target)/(1 + g) - r;
 if(bracket <= 0) return Infinity;
 return (c.cogs + c.ship + b.fixed)/bracket;
}

export type Rung = {
 tier:Tier;
 /** Retail price to charge, GST inclusive. */
 price:number;
 /** Revenue after GST is handed back. */
 netRev:number;
 gst:number;
 fee:number;
 feePctOfPrice:number;
 returns:number;
 /** Everything left before advertising. This IS the break-even CPA. */
 before:number;
 breakEvenCpa:number;
 /** Most you can pay per customer and still keep `keepPct` of net revenue. */
 targetCpa:number;
 /** Price as a multiple of landed cost, the number suppliers talk in. */
 multiple:number;
 grossMarginPct:number;
 /** Break-even return on ad spend at the target CPA. */
 breakEvenRoas:number;
 /** True when no price can hit this tier, or the target CPA is not positive. */
 unreachable:boolean;
 /** True when the market will not bear the solved price. */
 aboveMarket:boolean;
 /** True when the CPA you actually face is above what this rung can fund.
     A rung can be excellent on margin and still fail here, which is the
     failure the margin number alone hides. */
 cpaShort:boolean;
 /** Target CPA minus the CPA you actually pay, in dollars. Negative = short. */
 cpaHeadroom:number;
 /** Clears the market on price AND funds the CPA you actually pay. */
 viable:boolean;
};

/** One rung of the ladder.
    `marketPrice` of 0 means "not supplied", so no rung is marked above market.
    `actualCpa` of 0 means "not supplied", so no rung is marked CPA-short. */
export function rung(tier:Tier, c:Costs = DEFAULT_COSTS, marketPrice = 0, actualCpa = 0): Rung {
 const g = clamp(c.gstPct,0,100)/100;
 const price = priceFor(tier.before, c);
 const keep = clamp(c.keepPct,0,100)/100;

 if(!isFinite(price)){
  return {tier, price:Infinity, netRev:NaN, gst:NaN, fee:NaN, feePctOfPrice:NaN,
   returns:NaN, before:NaN, breakEvenCpa:NaN, targetCpa:NaN, multiple:Infinity,
   grossMarginPct:NaN, breakEvenRoas:NaN, unreachable:true, aboveMarket:false,
   cpaShort:true, cpaHeadroom:NaN, viable:false};
 }

 const netRev = price/(1+g);
 const gst = price - netRev;
 const fee = feeOn(price, c.fees);
 const returns = returnRate(c) * netRev;
 const before = netRev - c.cogs - c.ship - fee - returns;
 const targetCpa = before - keep*netRev;

 const unreachable = targetCpa <= 0;
 const aboveMarket = marketPrice > 0 && price > marketPrice;
 const cpaShort = actualCpa > 0 && targetCpa < actualCpa;

 return {
  tier, price, netRev, gst, fee,
  feePctOfPrice: fee/price*100,
  returns, before,
  breakEvenCpa: before,
  targetCpa,
  multiple: c.cogs > 0 ? price/c.cogs : Infinity,
  grossMarginPct: (netRev - c.cogs)/netRev*100,
  breakEvenRoas: targetCpa > 0 ? price/targetCpa : Infinity,
  unreachable, aboveMarket, cpaShort,
  cpaHeadroom: actualCpa > 0 ? targetCpa - actualCpa : NaN,
  viable: !unreachable && !aboveMarket && !cpaShort,
 };
}

export const ladder = (c:Costs = DEFAULT_COSTS, marketPrice = 0, actualCpa = 0) =>
 TIERS.map(t => rung(t, c, marketPrice, actualCpa));

/** The lowest retail price at which a given CPA is still affordable while
    keeping `keepPct`. Below this, no tier is advertisable at that CPA - the
    product is not too cheap to sell, it is too cheap to BUY traffic for.

    net - cogs - ship - (P*r + f) - k*net = cpa + keep*net
    => P * [ (1-k-keep)/(1+g) - r ] = cogs + ship + f + cpa */
export function minViablePrice(cpa:number, c:Costs = DEFAULT_COSTS){
 const g = clamp(c.gstPct,0,100)/100;
 const b = blended(c.fees);
 const bracket = (1 - returnRate(c) - clamp(c.keepPct,0,100)/100)/(1 + g) - b.pct/100;
 if(bracket <= 0) return Infinity;
 return (c.cogs + c.ship + b.fixed + Math.max(cpa,0))/bracket;
}

/* ── Scaling ───────────────────────────────────────────────────────────────
   Spend buys orders, but not at a flat price: CPA climbs as you push past the
   cheapest audience. `elasticity` is the exponent on that climb - 0 means CPA
   never moves (optimistic), 0.15 is a working default, 0.30 is harsh. There is
   no published constant for this, so it stays a dial the operator sets, never
   a number the tool predicts. */

export type ScalePoint = {
 spend:number; cpa:number; orders:number; revenue:number;
 contribution:number; profit:number; roas:number;
 /** Cash tied up in stock to support this run rate over the lead time. */
 stockCash:number;
};

export function cpaAtSpend(baseCpa:number, baseSpend:number, spend:number, elasticity:number){
 if(!(baseSpend > 0) || !(spend > 0) || elasticity <= 0) return baseCpa;
 return baseCpa * Math.pow(spend/baseSpend, elasticity);
}

export function scalePoint(
 r:Rung, c:Costs, spend:number,
 opts:{baseCpa:number; baseSpend:number; elasticity:number; fixedPerDay:number; leadDays:number},
): ScalePoint {
 const cpa = cpaAtSpend(opts.baseCpa, opts.baseSpend, spend, opts.elasticity);
 const orders = cpa > 0 ? spend/cpa : 0;
 const revenue = orders * r.price;
 const contribution = orders * (r.before - cpa);
 return {
  spend, cpa, orders, revenue, contribution,
  profit: contribution - opts.fixedPerDay,
  roas: spend > 0 ? revenue/spend : Infinity,
  stockCash: orders * c.cogs * Math.max(opts.leadDays, 0),
 };
}

/** The spend level where profit stops growing. Past this, every extra dollar
    of budget buys a customer that costs more than it brings. Found by walking
    the curve rather than differentiating, because CPA elasticity is a dial. */
export function peakSpend(
 r:Rung, c:Costs,
 opts:{baseCpa:number; baseSpend:number; elasticity:number; fixedPerDay:number; leadDays:number},
 max = 5000, steps = 400,
){
 let best = {spend:0, profit:-Infinity};
 for(let i=1;i<=steps;i++){
  const spend = max*i/steps;
  const p = scalePoint(r, c, spend, opts);
  if(p.profit > best.profit) best = {spend, profit:p.profit};
 }
 return best;
}
