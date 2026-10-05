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

/* ── The offer as a whole ────────────────────────────────────────────────────
   One order costs one CPA whichever pack it holds, so an offer is judged on the
   take-weighted average order, not pack by pack. A cheap single is allowed to
   be unable to buy a customer alone; the bundles beside it are what pay. */

// Relative pull of the 2-, 3- and 4-packs among buyers who take a bundle.
// 40:15 is CLEO's expected mix; the 4-pack's 10 extends it and is a guess.
const BUNDLE_SHAPE=[0,40,15,10];

/** Share of orders per pack. `units` lists the pack sizes on sale; `take` is
    the share of buyers (0 to 1) who pick any bundle over the single. */
export function mixForTake(units,take){
  const pull=units.map(u=>u>1?BUNDLE_SHAPE[u-1]:0),total=pull.reduce((a,b)=>a+b,0);
  if(!total)return units.map(()=>1/units.length);
  const s=units.includes(1)?Math.max(0,Math.min(1,take)):1;
  return units.map((u,i)=>u===1?1-s:s*pull[i]/total);
}

/** Blend priced packs (offerAtPrice results) by their share of orders. */
export function blendOffers(offers,weights,cpa=TRAFFIC_FLOOR_CPA){
  const sum=k=>offers.reduce((a,o,i)=>a+weights[i]*o[k],0);
  const aov=sum('price'),net=sum('net'),targetCpa=sum('targetCpa'),breakEvenCpa=sum('breakEvenCpa');
  const profit=breakEvenCpa-cpa;
  return {aov,net,cost:sum('cost'),fee:sum('fee'),targetCpa,breakEvenCpa,profit,margin:profit/net,
    verdict:targetCpa>=cpa?'good':breakEvenCpa>=cpa?'tight':'bad'};
}

/** Bundle take (0 to 1) at which the blended `key` ('targetCpa' or
    'breakEvenCpa') reaches `cpa`. 0 = the single already gets there; null =
    not reachable even if every buyer takes a bundle, or no single/bundle to mix. */
export function takeNeeded(units,offers,key,cpa=TRAFFIC_FLOOR_CPA){
  const i1=units.indexOf(1);
  if(i1<0||units.length<2)return null;
  const single=offers[i1][key],w=mixForTake(units,1);
  const bundles=offers.reduce((a,o,i)=>a+w[i]*o[key],0);
  if(single>=cpa)return 0;
  if(bundles<cpa)return null;
  return (cpa-single)/(bundles-single);
}
