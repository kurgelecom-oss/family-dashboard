// Generated from app/lib/ecom/bundles.ts by scripts/build-offer-model.mjs. Do not edit.
import { blended as blendedFee } from './shopify-fees.mjs';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const returnRate = (sc) => (clamp(sc.retPct, 0, 100) / 100) * (clamp(sc.retLossPct, 0, 100) / 100);
export function costFor(units, sc) {
    const u = Math.max(Math.round(units), 1);
    const t = sc.totals;
    const total = t.length ? (t[u - 1] ?? t[t.length - 1]) : 0;
    return Math.max(total, 0) + Math.max(sc.extraPerOrder, 0) + blendedFee(sc.fees).fixed;
}
export function costPerUnit(units, sc) {
    const u = Math.max(Math.round(units), 1);
    const t = sc.totals;
    const total = t.length ? (t[u - 1] ?? t[t.length - 1]) : NaN;
    return total / u;
}
export function slope(target, sc) {
    const g = clamp(sc.gstPct, 0, 100) / 100;
    return (1 - returnRate(sc) - target) / (1 + g) - blendedFee(sc.fees).pct / 100;
}
export const cpaSlope = (sc) => slope(clamp(sc.keepPct, 0, 100) / 100, sc);
export function solvePrice(target, units, sc) {
    const s = slope(target, sc);
    if (s <= 0)
        return Infinity;
    return costFor(units, sc) / s;
}
export function marginalCost(units, sc) {
    const u = Math.max(Math.round(units), 1);
    if (u < 2)
        return NaN;
    const t = sc.totals;
    const hi = t[u - 1] ?? t[t.length - 1];
    const lo = t[u - 2] ?? t[t.length - 1];
    return hi - lo;
}
export function cpaFundedPrice(units, sc, cpa) {
    const A = cpaSlope(sc);
    if (A <= 0)
        return Infinity;
    return (costFor(units, sc) + Math.max(cpa, 0)) / A;
}
export function maxCostAt(price, sc, cpa) {
    return price * cpaSlope(sc) - Math.max(cpa, 0) - Math.max(sc.extraPerOrder, 0) - blendedFee(sc.fees).fixed;
}
export function marginAt(price, units, sc) {
    const net = price / (1 + clamp(sc.gstPct, 0, 100) / 100);
    if (!(net > 0))
        return NaN;
    return (price * slope(0, sc) - costFor(units, sc)) / net;
}
export function row(target, units, sc, singlePrice, singleTarget, actualCpa = 0) {
    const u = Math.max(Math.round(units), 1);
    const g = clamp(sc.gstPct, 0, 100) / 100;
    const price = solvePrice(target, u, sc);
    const t = sc.totals;
    const supplierTotal = t.length ? (t[u - 1] ?? t[t.length - 1]) : NaN;
    if (!isFinite(price)) {
        return { units: u, price: Infinity, pricePerUnit: Infinity, supplierTotal,
            supplierPerUnit: supplierTotal / u, impliedDisc: NaN, netRev: NaN, gst: NaN, fee: NaN,
            cost: NaN, returns: NaN, before: NaN, breakEvenCpa: NaN, targetCpa: NaN, headroom: NaN,
            maxDisc: NaN, fundsCpa: false, unreachable: true,
            marginalCost: marginalCost(u, sc), cpaFundedPrice: cpaFundedPrice(u, sc, actualCpa) };
    }
    const netRev = price / (1 + g);
    const f = blendedFee(sc.fees);
    const fee = price * f.pct / 100 + f.fixed;
    const cost = Math.max(supplierTotal, 0) + Math.max(sc.extraPerOrder, 0);
    const returns = returnRate(sc) * netRev;
    const before = netRev - cost - fee - returns;
    const targetCpa = before - clamp(sc.keepPct, 0, 100) / 100 * netRev;
    const A = cpaSlope(sc);
    const C = costFor(u, sc);
    const list = singlePrice * u;
    let maxDisc = NaN;
    if (A > 0 && list > 0)
        maxDisc = 1 - (singleTarget + C) / (A * list);
    return {
        units: u, price, pricePerUnit: price / u,
        supplierTotal, supplierPerUnit: supplierTotal / u,
        impliedDisc: list > 0 ? 1 - price / list : NaN,
        netRev, gst: price - netRev, fee, cost, returns,
        before, breakEvenCpa: before, targetCpa,
        headroom: singleTarget > 0 ? targetCpa / singleTarget : NaN,
        maxDisc,
        fundsCpa: actualCpa <= 0 ? true : targetCpa >= actualCpa,
        unreachable: false,
        marginalCost: marginalCost(u, sc),
        cpaFundedPrice: cpaFundedPrice(u, sc, actualCpa),
    };
}
export function ladder(target, sc, actualCpa = 0) {
    const n = Math.max(sc.totals.length, 1);
    const singlePrice = solvePrice(target, 1, sc);
    const single = row(target, 1, sc, isFinite(singlePrice) ? singlePrice : 1, 1, actualCpa);
    const singleTarget = single.targetCpa;
    return Array.from({ length: n }, (_, i) => row(target, i + 1, sc, singlePrice, singleTarget, actualCpa));
}
export function normaliseMix(mix, n) {
    const m = Array.from({ length: n }, (_, i) => Math.max(mix[i] ?? 0, 0));
    const t = m.reduce((a, b) => a + b, 0);
    if (!(t > 0))
        return m.map((_, i) => i === 0 ? 1 : 0);
    return m.map(v => v / t);
}
export function blend(rows, mix) {
    if (!rows.length)
        return null;
    const w = normaliseMix(mix, rows.length);
    const sum = (f) => rows.reduce((a, r, i) => a + w[i] * (isFinite(f(r)) ? f(r) : 0), 0);
    const targetCpa = sum(r => r.targetCpa);
    return {
        weights: w,
        unitsPerOrder: sum(r => r.units),
        aov: sum(r => r.price),
        costPerOrder: sum(r => r.cost),
        breakEvenCpa: sum(r => r.before),
        targetCpa,
        upliftVsSingle: rows[0].targetCpa > 0 ? targetCpa / rows[0].targetCpa : NaN,
        multiShare: rows.reduce((a, r, i) => a + (r.units > 1 ? w[i] : 0), 0),
    };
}
export function mixAtMultiShare(rows, shape, multiShare) {
    const s = clamp(multiShare, 0, 1);
    const total = rows.reduce((a, r, i) => a + (r.units > 1 ? Math.max(shape[i] ?? 0, 0) : 0), 0);
    const multiCount = rows.filter(r => r.units > 1).length || 1;
    return rows.map((r, i) => {
        if (r.units <= 1)
            return 1 - s;
        if (!(total > 0))
            return s / multiCount;
        return s * Math.max(shape[i] ?? 0, 0) / total;
    });
}
export function multiShareNeeded(rows, shape, cpa) {
    for (let i = 0; i <= 100; i++) {
        const b = blend(rows, mixAtMultiShare(rows, shape, i / 100));
        if (b && b.targetCpa >= cpa)
            return i / 100;
    }
    return null;
}
export function supplierVolumeDiscount(sc) {
    const n = sc.totals.length;
    if (n < 2)
        return NaN;
    const one = costPerUnit(1, sc), top = costPerUnit(n, sc);
    if (!(one > 0))
        return NaN;
    return 1 - top / one;
}
