// Generated from app/lib/ecom/tiers.ts by scripts/build-offer-model.mjs. Do not edit.
import { feeOn, blended, DEFAULT_FEES } from './shopify-fees.mjs';
export const TIERS = [
    { key: 'excellent', label: 'Excellent', before: 0.65, blurb: 'Room to outbid almost anyone and still keep a top-decile margin.' },
    { key: 'good', label: 'Good', before: 0.55, blurb: 'Can fund a competitive CPA and hold a 20%+ margin.' },
    { key: 'average', label: 'Average', before: 0.45, blurb: 'Works at a disciplined CPA. No room for a bad week.' },
    { key: 'poor', label: 'Poor', before: 0.35, blurb: 'Only survives on cheap traffic. One CPA rise kills it.' },
];
export const DEFAULT_COSTS = {
    cogs: 12, ship: 7, retPct: 8, retLossPct: 25, gstPct: 0, fees: DEFAULT_FEES, keepPct: 20,
};
export const TRAFFIC_FLOOR_CPA = 45;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const returnRate = (c) => (clamp(c.retPct, 0, 100) / 100) * (clamp(c.retLossPct, 0, 100) / 100);
export function priceFor(target, c = DEFAULT_COSTS) {
    const g = clamp(c.gstPct, 0, 100) / 100;
    const b = blended(c.fees);
    const r = b.pct / 100;
    const k = returnRate(c);
    const bracket = (1 - k - target) / (1 + g) - r;
    if (bracket <= 0)
        return Infinity;
    return (c.cogs + c.ship + b.fixed) / bracket;
}
export function rung(tier, c = DEFAULT_COSTS, marketPrice = 0, actualCpa = 0) {
    const g = clamp(c.gstPct, 0, 100) / 100;
    const price = priceFor(tier.before, c);
    const keep = clamp(c.keepPct, 0, 100) / 100;
    if (!isFinite(price)) {
        return { tier, price: Infinity, netRev: NaN, gst: NaN, fee: NaN, feePctOfPrice: NaN,
            returns: NaN, before: NaN, breakEvenCpa: NaN, targetCpa: NaN, multiple: Infinity,
            grossMarginPct: NaN, breakEvenRoas: NaN, unreachable: true, aboveMarket: false,
            cpaShort: true, cpaHeadroom: NaN, viable: false };
    }
    const netRev = price / (1 + g);
    const gst = price - netRev;
    const fee = feeOn(price, c.fees);
    const returns = returnRate(c) * netRev;
    const before = netRev - c.cogs - c.ship - fee - returns;
    const targetCpa = before - keep * netRev;
    const unreachable = targetCpa <= 0;
    const aboveMarket = marketPrice > 0 && price > marketPrice;
    const cpaShort = actualCpa > 0 && targetCpa < actualCpa;
    return {
        tier, price, netRev, gst, fee,
        feePctOfPrice: fee / price * 100,
        returns, before,
        breakEvenCpa: before,
        targetCpa,
        multiple: c.cogs > 0 ? price / c.cogs : Infinity,
        grossMarginPct: (netRev - c.cogs) / netRev * 100,
        breakEvenRoas: targetCpa > 0 ? price / targetCpa : Infinity,
        unreachable, aboveMarket, cpaShort,
        cpaHeadroom: actualCpa > 0 ? targetCpa - actualCpa : NaN,
        viable: !unreachable && !aboveMarket && !cpaShort,
    };
}
export const ladder = (c = DEFAULT_COSTS, marketPrice = 0, actualCpa = 0) => TIERS.map(t => rung(t, c, marketPrice, actualCpa));
export function minViablePrice(cpa, c = DEFAULT_COSTS) {
    const g = clamp(c.gstPct, 0, 100) / 100;
    const b = blended(c.fees);
    const bracket = (1 - returnRate(c) - clamp(c.keepPct, 0, 100) / 100) / (1 + g) - b.pct / 100;
    if (bracket <= 0)
        return Infinity;
    return (c.cogs + c.ship + b.fixed + Math.max(cpa, 0)) / bracket;
}
export function cpaAtSpend(baseCpa, baseSpend, spend, elasticity) {
    if (!(baseSpend > 0) || !(spend > 0) || elasticity <= 0)
        return baseCpa;
    return baseCpa * Math.pow(spend / baseSpend, elasticity);
}
export function scalePoint(r, c, spend, opts) {
    const cpa = cpaAtSpend(opts.baseCpa, opts.baseSpend, spend, opts.elasticity);
    const orders = cpa > 0 ? spend / cpa : 0;
    const revenue = orders * r.price;
    const contribution = orders * (r.before - cpa);
    return {
        spend, cpa, orders, revenue, contribution,
        profit: contribution - opts.fixedPerDay,
        roas: spend > 0 ? revenue / spend : Infinity,
        stockCash: orders * c.cogs * Math.max(opts.leadDays, 0),
    };
}
export function peakSpend(r, c, opts, max = 5000, steps = 400) {
    let best = { spend: 0, profit: -Infinity };
    for (let i = 1; i <= steps; i++) {
        const spend = max * i / steps;
        const p = scalePoint(r, c, spend, opts);
        if (p.profit > best.profit)
            best = { spend, profit: p.profit };
    }
    return best;
}
