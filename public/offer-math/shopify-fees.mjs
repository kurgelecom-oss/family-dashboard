// Generated from app/lib/ecom/shopify-fees.ts by scripts/build-offer-model.mjs. Do not edit.
export const AU_RATES = {
    basic: { domestic: { pct: 1.75, fixed: 0.30 }, amex: { pct: 2.9, fixed: 0.30 }, international: { pct: 3.5, fixed: 0.30 }, thirdPartySurchargePct: 2.0 },
    grow: { domestic: { pct: 1.6, fixed: 0.30 }, amex: { pct: 2.8, fixed: 0.30 }, international: { pct: 3.4, fixed: 0.30 }, thirdPartySurchargePct: 1.0 },
    advanced: { domestic: { pct: 1.4, fixed: 0.30 }, amex: { pct: 2.7, fixed: 0.30 }, international: { pct: 3.3, fixed: 0.30 }, thirdPartySurchargePct: 0.6 },
};
export const DEFAULT_MIX = { domestic: 0.85, amex: 0.05, international: 0.10 };
export const DEFAULT_FEES = { plan: 'basic', mix: DEFAULT_MIX, thirdParty: false, extraPct: 0, flat: { pct: 2.9, fixed: 0.30 } };
export function normalise(mix) {
    const t = mix.domestic + mix.amex + mix.international;
    if (!(t > 0))
        return DEFAULT_MIX;
    return { domestic: mix.domestic / t, amex: mix.amex / t, international: mix.international / t };
}
export function blended(cfg) {
    if (cfg.flat)
        return { pct: cfg.flat.pct + Math.max(cfg.extraPct, 0), fixed: cfg.flat.fixed };
    const r = AU_RATES[cfg.plan];
    const m = normalise(cfg.mix);
    const pct = r.domestic.pct * m.domestic + r.amex.pct * m.amex + r.international.pct * m.international
        + (cfg.thirdParty ? r.thirdPartySurchargePct : 0)
        + Math.max(cfg.extraPct, 0);
    const fixed = r.domestic.fixed * m.domestic + r.amex.fixed * m.amex + r.international.fixed * m.international;
    return { pct, fixed };
}
export function feeOn(gross, cfg = DEFAULT_FEES) {
    const b = blended(cfg);
    return Math.max(gross, 0) * b.pct / 100 + (gross > 0 ? b.fixed : 0);
}
export function effectivePct(gross, cfg = DEFAULT_FEES) {
    if (!(gross > 0))
        return NaN;
    return feeOn(gross, cfg) / gross * 100;
}
