// Presentation adapter only. Browser modules are generated from the canonical
// TypeScript before tests and production builds; financial formulas live there.
import {DEFAULT_FEES} from './offer-math/shopify-fees.mjs';
import {TIERS,DEFAULT_COSTS,TRAFFIC_FLOOR_CPA} from './offer-math/tiers.mjs';
import {ladder,cpaFundedPrice,maxCostAt,marginAt} from './offer-math/bundles.mjs';
export {TIERS};
export const ASSUMPTIONS={gstPct:DEFAULT_COSTS.gstPct,keepPct:DEFAULT_COSTS.keepPct,
  retPct:DEFAULT_COSTS.retPct,retLossPct:DEFAULT_COSTS.retLossPct,floorCpa:TRAFFIC_FLOOR_CPA};

// `cpa` is the CPA each offer is judged against. Nobody types it any more:
// the CPA an offer can pay (targetCpa, breakEvenCpa) is solved from landed cost,
// and the yardstick defaults to the store-level traffic floor.
function setup({cost,cpa=TRAFFIC_FLOOR_CPA,plan=DEFAULT_FEES.plan,
  retPct=DEFAULT_COSTS.retPct,retLossPct=DEFAULT_COSTS.retLossPct,extraPerOrder=0}) {
  // The selected supplier total already represents the entire pack. It must
  // never be multiplied by its unit count, or charged delivery a second time.
  const sc={totals:[cost],extraPerOrder,retPct,retLossPct,
    gstPct:DEFAULT_COSTS.gstPct,keepPct:DEFAULT_COSTS.keepPct,fees:{...DEFAULT_FEES,plan}};
  const floor=cpaFundedPrice(1,sc,cpa);
  return {sc,cpa,floor,floorMargin:marginAt(floor,1,sc)};
}
function build({sc,cpa,floor,floorMargin},tier,target){
  const r=ladder(target,sc,cpa)[0];
  const profit=r.before-cpa;
  const kept=r.before-r.targetCpa;
  return {...tier,...r,net:r.netRev,floor,profit,margin:profit/r.netRev,
    headroom:r.targetCpa-cpa,kept,keptMargin:kept/r.netRev,
    roasNeeded:r.targetCpa>0?r.price/r.targetCpa:Infinity,
    fundsCpa:!r.unreachable&&r.targetCpa>=cpa,
    tierPct:Math.round(target*100),floorMargin,maxCost:maxCostAt(r.price,sc,cpa),
    // good: funds the CPA and keeps the margin. tight: still profitable at
    // that CPA but keeps less. bad: every order loses money at that CPA.
    verdict:r.unreachable?'bad':r.targetCpa>=cpa?'good':r.breakEvenCpa>=cpa?'tight':'bad'};
}
export function calculateOffers(opts) {
  const ctx=setup(opts);
  return TIERS.map(tier=>build(ctx,tier,tier.before));
}
// A price the operator typed. The tiers solve price from margin; this runs the
// same maths the other way, so a typed price is graded exactly like a solved one.
export function offerAtPrice({price,...opts}) {
  const ctx=setup(opts);
  return build(ctx,{key:'custom',label:'Your price'},marginAt(price,1,ctx.sc));
}
