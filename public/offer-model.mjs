// Presentation adapter only. Browser modules are generated from the canonical
// TypeScript before tests and production builds; financial formulas live there.
import {DEFAULT_FEES} from './offer-math/shopify-fees.mjs';
import {TIERS,DEFAULT_COSTS} from './offer-math/tiers.mjs';
import {ladder,cpaFundedPrice} from './offer-math/bundles.mjs';
export {TIERS};
export const ASSUMPTIONS={gstPct:DEFAULT_COSTS.gstPct,keepPct:DEFAULT_COSTS.keepPct,
  retPct:DEFAULT_COSTS.retPct,retLossPct:DEFAULT_COSTS.retLossPct};

export function calculateOffers({cost,cpa,plan=DEFAULT_FEES.plan,
  retPct=DEFAULT_COSTS.retPct,retLossPct=DEFAULT_COSTS.retLossPct,extraPerOrder=0}) {
  // The selected supplier total already represents the entire pack. It must
  // never be multiplied by its unit count, or charged delivery a second time.
  const sc={totals:[cost],extraPerOrder,retPct,retLossPct,
    gstPct:DEFAULT_COSTS.gstPct,keepPct:DEFAULT_COSTS.keepPct,fees:{...DEFAULT_FEES,plan}};
  const floor=cpaFundedPrice(1,sc,cpa);
  return TIERS.map(tier=>{
    const r=ladder(tier.before,sc,cpa)[0];
    const profit=r.before-cpa;
    return {...tier,...r,net:r.netRev,floor,profit,margin:profit/r.netRev,
      headroom:r.targetCpa-cpa};
  });
}
