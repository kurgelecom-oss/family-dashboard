# Offer Engine — how to read the ladder

Live at `/offer.html`. You enter one number: what the supplier charges you,
landed. Everything else is solved.

---

## The one input

**Landed cost per unit.** Not the invoice price. The invoice *plus* freight,
duty, brokerage and inbound handling, ex-GST.

This matters more than any other field on the page. In global trade the
product itself is about 45% of the total landed cost — freight 25%, duties
15%, taxes 10%, handling 5%. Brands that price off the invoice price alone
understate their cost base by 20–40%, which is more than most of them make.

Everything else on the left is either a cost you already know (fulfilment,
returns) or a rate you can look up (Shopify, GST).

---

## The four tiers

A tier is named for **how much of each order is left before advertising**, as
a share of revenue after GST. That slice is the only money available to buy a
customer and to keep.

| Tier | Before ads | What it means |
|---|---|---|
| **Excellent** | 65% of net revenue | Outbid almost anyone and still keep a top-decile margin. |
| **Good** | 55% | Funds a competitive CPA and holds 20%+. |
| **Average** | 45% | Works at a disciplined CPA. No room for a bad week. |
| **Poor** | 35% | Only survives on cheap traffic. One CPA rise kills it. |

### Where those cut-offs come from

They are not round numbers picked for looks. Published 2026 DTC benchmarks
give two anchors:

- Median contribution margin **after** ads is 15–20%. Top decile is 28%+.
- Ad spend runs 20–30% of revenue.

So an average offer keeps 20% and spends 25% on ads, which needs 45% before
ads. A top-decile offer keeps 28% and spends 27%, which needs 55%+. The
Excellent and Poor rungs sit one step either side.

---

## What each rung gives you

- **Required retail price** — what you would have to charge, GST included.
- **Multiple on landed cost** — the number suppliers and competitors talk in.
  Keystone is 2x (50% gross margin), triple keystone is 4x (75%). Above 4x,
  the supplier price is usually the real problem.
- **Target CPA** — the most you can pay per customer and still keep your
  chosen margin.
- **Break-even CPA** — everything the order has left. Pay this and you keep
  nothing; pay more and each sale destroys money.
- **Break-even ROAS** — what the ads must return to hold the target margin.
- **Shopify takes** — the fee in dollars and as a percentage of that price.

---

## Why price is solved, not marked up

Shopify's percentage, GST and the expected cost of returns all scale with the
price. A flat "3x cost" rule ignores that and lands in the wrong place. The
engine solves the equation instead:

```
net     = P / (1 + gst)
fee     = P × rate + fixed
returns = returnRate × lossPerReturn × net

net − cogs − ship − fee − returns = target × net

=>  P × [ (1 − k − target) / (1 + gst) − rate ] = cogs + ship + fixed
    where k = returnRate × lossPerReturn
```

If the bracket is zero or negative, no price works and the rung reads
**Impossible** rather than printing a nonsense number.

---

## The three ways a rung fails

A rung greys out for one of three reasons, and they are not the same problem.

1. **Impossible** — no price reaches that tier at this cost base. The
   variable rates plus the target already exceed the order. Fix the cost
   base; price cannot save it.
2. **Above market** — the solved price is higher than the market price you
   entered. The maths works; customers will not pay it.
3. **CPA short** — the rung's target CPA is below the CPA you actually pay.
   This is the one the margin number alone hides. A rung can show an 80%
   gross margin and still be unadvertisable.

**The floor** panel answers the question those three raise: the minimum
retail price at which the CPA you actually pay is affordable at all. Below
it, the product is not too cheap to sell. It is too cheap to buy traffic for.

---

## Shopify's cut is not one number

The fee engine blends the real rate card rather than using one average:

| Plan | Domestic | Amex | International | Third-party gateway |
|---|---|---|---|---|
| Basic | 1.75% + 30c | 2.9% + 30c | 3.5% + 30c | +2.0% |
| Grow | 1.6% + 30c | 2.8% + 30c | 3.4% + 30c | +1.0% |
| Advanced | 1.4% + 30c | 2.7% + 30c | 3.3% + 30c | +0.6% |

Shopify Payments Australia, online card, verified 4 October 2026.

The 30c does not care what you charge, so **the effective rate climbs as the
price falls**. At a $14 order it is over 2% on its own. That is why a cheap
rung is always worse than its percentage suggests, and why the fee chart on
the page plots the curve with your four prices marked on it.

Set the card mix to your own. An international-heavy mix costs roughly a full
point more than a domestic one.

---

## The scaling panel

Spend buys orders, but not at a flat price. The **CPA climb** slider is the
exponent on how much CPA rises each time you double spend.

There is no published constant for this. It is your dial, set from your own
account history, and the page never predicts it for you. At 0 the curve never
turns down, which is a useful sanity check rather than a forecast.

Read three things:

- **Where the line crosses zero.** That budget stops paying for itself.
- **The dot.** Each rung's most profitable daily spend.
- **Stock cash tied up.** Orders per day × landed cost × lead time.

That last one is the trap. A rung can be profitable at $5,000 a day and still
sink you, because the stock behind it is paid for weeks before the revenue
arrives. Growth at that rate is a funding decision before it is a marketing
one. The page warns when the cash required exceeds about 90 days of profit.

---

## Honest limits

- **Dollar CPA benchmarks are US-sourced.** The seeded bands per category
  come from 2026 Meta ecommerce data in USD. Your figures are AUD. Convert
  before judging the CPA gate, or overwrite the seeded number with your own.
- **One product at a time.** This models a single landed cost and a single
  price. A multi-SKU store with mix shift needs weighted inputs.
- **The market price field is optional and unverified.** Nothing on the page
  knows what customers will pay. Until you fill it in, no rung is marked
  above market, and "Excellent" means excellent *on margin only*.
- **The CPA climb is an assumption, not a measurement.**

---

## Where the maths lives

The page is a single static file and carries its own copy of the formulas so
it works with no build step. The canonical, unit-tested statement of them is:

- `app/lib/ecom/shopify-fees.ts` — the fee engine
- `app/lib/ecom/tiers.ts` — the ladder, the floor, the scaling curve
- `app/lib/ecom/tiers.test.ts` — 21 checks, run by `npm test`

If a formula changes in one place, change it in both.

---

## Sources

Shopify Payments Australia published rate card (verified 4 Oct 2026).
Contribution-margin deciles and category spreads: Level CFO 2026 Ecommerce &
DTC Financial Benchmarks, Commerce Catalyst 2026 DTC Benchmarks, Saras
Analytics. Meta purchase CPA by vertical: Triple Whale, AdLibrary, Sovran.
Return rates and the cost of a return: ShipNetwork, 3PL Guys. Shipping as a
share of revenue and effective payment-processing rates: EightX, Swipesum.
MER, blended ROAS and LTV:CAC norms: Lebesgue, Daymark. Landed-cost
composition and markup multiples: Syncost, Passport Global, EightX.
