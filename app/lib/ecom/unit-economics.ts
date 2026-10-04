/* The unit-economics model behind public/ecom.html.
   The page ships as a self-contained static file, so it carries its own copy
   of these formulas inline. This module is the canonical statement of them and
   exists so the arithmetic is covered by `npm test` rather than only by eye.
   Keep the two in step: if a formula changes in the page, change it here. */

export type Inputs = {
 price:number; discPct:number; cogs:number; ship:number; feePct:number;
 retPct:number; retLossPct:number; cpa:number; newPct:number;
};

/* Most operators are wrong in the same direction: CAC understated by 20-40%,
   returns understated, discount leakage forgotten. The stress case bakes that
   in so a product cannot pass on the clean case alone. */
export const STRESS = {cpa:1.30, ret:1.20, price:0.95};

const clamp = (v:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,v));

export function model(b:Inputs, stressed = false){
 const price  = b.price * (stressed ? STRESS.price : 1);
 const disc   = price * clamp(b.discPct,0,100)/100;
 const netRev = price - disc;

 const cogs = b.cogs;
 const ship = b.ship;
 const fee  = netRev * clamp(b.feePct,0,100)/100;

 /* A return consumes a share of the order's value: reverse postage,
    inspection, restock, support time and markdown. Expected cost per order
    is therefore rate x loss-share x value, not rate x value. */
 const retRate = clamp(b.retPct * (stressed ? STRESS.ret : 1), 0, 100)/100;
 const ret = retRate * clamp(b.retLossPct,0,100)/100 * netRev;

 const gp = netRev - cogs;

 /* Everything the order has left before advertising. This IS the break-even
    CPA: pay less and the order makes money, pay more and it destroys money. */
 const before = gp - ship - fee - ret;

 const cpa   = b.cpa * (stressed ? STRESS.cpa : 1);
 const newSh = clamp(b.newPct,0,100)/100;
 /* Only new-customer orders carry acquisition cost; repeat orders ride free,
    which is why the blended line flatters a new customer's first order. */
 const acq     = cpa * newSh;
 const contrib = before - acq;

 const ordersPerCustomer = newSh > 0 ? 1/newSh : 1;
 const ltv = before * ordersPerCustomer;

 return {
  price, disc, netRev, cogs, ship, fee, ret, gp, before, cpa, acq, contrib,
  newSh, ordersPerCustomer, ltv,
  gmPct:   netRev>0 ? gp/netRev*100      : NaN,
  cmPct:   netRev>0 ? contrib/netRev*100 : NaN,
  roas:    cpa>0    ? netRev/cpa         : Infinity,
  beRoas:  before>0 ? netRev/before      : Infinity,
  ltvCac:  cpa>0    ? ltv/cpa            : Infinity,
 };
}

/* The target contribution margin the "What it would take" panel solves for. */
export const CM_TARGET = 0.20;

/* Variable costs that scale with price, as a rate. Fees and the expected
   return loss both move with revenue; COGS, fulfilment and acquisition do not. */
export const varRate = (b:Inputs) =>
 clamp(b.feePct,0,100)/100 + (clamp(b.retPct,0,100)/100)*(clamp(b.retLossPct,0,100)/100);

/** Highest CPA that still leaves CM_TARGET, expressed per new customer. */
export function maxCpa(b:Inputs){
 const m = model(b);
 const maxAcq = m.before - CM_TARGET*m.netRev;
 return m.newSh>0 ? maxAcq/m.newSh : maxAcq;
}

/** AOV needed to hit CM_TARGET with costs and CPA held. Solved, not marked up:
    fees and returns scale with price, so a flat markup overshoots. */
export function priceFor(b:Inputs){
 const m = model(b);
 const denom = 1 - varRate(b) - CM_TARGET;
 if(denom <= 0) return Infinity;
 const needNet = (m.cogs + m.ship + m.acq)/denom;
 return needNet/(1 - clamp(b.discPct,0,100)/100);
}

/** Landed-COGS ceiling at today's price and CPA for CM_TARGET. */
export function cogsCeiling(b:Inputs){
 const m = model(b);
 return m.netRev*(1 - varRate(b) - CM_TARGET) - m.ship - m.acq;
}

/** Orders per period needed to cover fixed costs at today's contribution. */
export function breakEvenOrders(b:Inputs, fixedPerPeriod:number){
 const m = model(b);
 return m.contrib>0 ? fixedPerPeriod/m.contrib : Infinity;
}
