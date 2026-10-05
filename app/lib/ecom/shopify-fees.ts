/* Shopify Payments fee engine.

   Why this exists: a single blended percentage is wrong at both ends of a
   price ladder. The per-transaction fixed component (30c in AU) is a tiny
   share of a $90 order and over 2% of a $14 one, so the effective rate RISES
   as price falls. A COGS-in calculator that prints cheap price tiers has to
   model that, or every low tier reads better than it is.

   Rates below are Shopify Payments Australia, online card, as published for
   the 2026 plan line-up. Verified 4 Oct 2026. They are data, not constants:
   the UI exposes them so a plan change or a rate change is an edit, not a
   rebuild. */

export type Plan = 'basic' | 'grow' | 'advanced';

export type CardRates = {
 /** Domestic Visa / Mastercard / eftpos, online. */
 domestic: {pct:number; fixed:number};
 /** American Express, online. */
 amex: {pct:number; fixed:number};
 /** Cards issued outside Australia, online. */
 international: {pct:number; fixed:number};
 /** Extra Shopify charge when NOT using Shopify Payments. */
 thirdPartySurchargePct: number;
};

export const AU_RATES: Record<Plan, CardRates> = {
 basic:    {domestic:{pct:1.75,fixed:0.30}, amex:{pct:2.9,fixed:0.30}, international:{pct:3.5,fixed:0.30}, thirdPartySurchargePct:2.0},
 grow:     {domestic:{pct:1.6, fixed:0.30}, amex:{pct:2.8,fixed:0.30}, international:{pct:3.4,fixed:0.30}, thirdPartySurchargePct:1.0},
 advanced: {domestic:{pct:1.4, fixed:0.30}, amex:{pct:2.7,fixed:0.30}, international:{pct:3.3,fixed:0.30}, thirdPartySurchargePct:0.6},
};

/** Share of orders by card type. Must sum to 1; the engine normalises if not. */
export type CardMix = {domestic:number; amex:number; international:number};

export const DEFAULT_MIX: CardMix = {domestic:0.85, amex:0.05, international:0.10};

export type FeeConfig = {
 plan: Plan;
 mix: CardMix;
 /** true when payments run through an external gateway, which adds the surcharge. */
 thirdParty: boolean;
 /** Extra points added to every transaction: Afterpay/Klarna uplift, FX, chargebacks. */
 extraPct: number;
 /** One flat rate that replaces the plan and card-mix blend when set. */
 flat?: {pct:number; fixed:number};
};

/* The stores sell to the US in USD, and the Launchpad test row carries the fee
   every agent already uses: fee_pct 0.029, fee_fixed 0.30. The default is that
   flat rate so the Offer Engine and the Launchpad price an order the same way.
   The AU rate card above still drives any config that leaves `flat` unset. */
export const DEFAULT_FEES: FeeConfig = {plan:'basic', mix:DEFAULT_MIX, thirdParty:false, extraPct:0, flat:{pct:2.9, fixed:0.30}};

/** Mix weights normalised to sum to 1. Guards against a UI that lets the three
    boxes drift, which would otherwise silently scale the whole fee. */
export function normalise(mix:CardMix): CardMix {
 const t = mix.domestic + mix.amex + mix.international;
 if(!(t > 0)) return DEFAULT_MIX;
 return {domestic:mix.domestic/t, amex:mix.amex/t, international:mix.international/t};
}

/** Blended percentage and blended fixed component for a card mix. */
export function blended(cfg:FeeConfig){
 if(cfg.flat) return {pct:cfg.flat.pct + Math.max(cfg.extraPct, 0), fixed:cfg.flat.fixed};
 const r = AU_RATES[cfg.plan];
 const m = normalise(cfg.mix);
 const pct = r.domestic.pct*m.domestic + r.amex.pct*m.amex + r.international.pct*m.international
   + (cfg.thirdParty ? r.thirdPartySurchargePct : 0)
   + Math.max(cfg.extraPct, 0);
 const fixed = r.domestic.fixed*m.domestic + r.amex.fixed*m.amex + r.international.fixed*m.international;
 return {pct, fixed};
}

/** Fee in dollars on an order charged at `gross` (GST-inclusive: processors
    take their cut of the whole amount the customer pays, tax included). */
export function feeOn(gross:number, cfg:FeeConfig = DEFAULT_FEES){
 const b = blended(cfg);
 return Math.max(gross, 0) * b.pct/100 + (gross > 0 ? b.fixed : 0);
}

/** The number people think they are paying: fee as a percentage of the order.
    This is what rises as price falls, and the reason the fixed cent matters. */
export function effectivePct(gross:number, cfg:FeeConfig = DEFAULT_FEES){
 if(!(gross > 0)) return NaN;
 return feeOn(gross, cfg)/gross*100;
}
