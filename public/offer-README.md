# Offer Engine — how to read the ladder

Live at `/offer.html`. You paste in your supplier's quote. Everything else on
the page is solved from it.

## Current Compare view

Enter a delivered total for each 1–4-unit pack. Blank optional pack sizes are
unavailable until a quote is entered. Select a pack, then compare its four
margin tiers. The light/dark preference is saved in the browser.

There is no separate shipping charge, cost-settings panel, or manual
bundle-discount calculator. Enter the fully delivered total for each pack.
The page uses the canonical defaults for Shopify Basic, return assumptions,
GST, and retained margin; additional per-order costs default to zero.

The browser uses generated modules in `public/offer-math/`. Both `npm test`
and `npm run build` regenerate them from the canonical
`app/lib/ecom/{shopify-fees,tiers,bundles}.ts` via
`scripts/build-offer-model.mjs`. Edit those TypeScript sources, never the
generated files. `public/offer-model.mjs` only adapts their results for display.

The remaining sections document the underlying model, including blend and
scale analyses that are not displayed in the simplified Compare view.

---

## The input: your supplier's quote

Suppliers quote like this, and this is what you paste in:

| PCS | Cost | Freight | **Total** |
|---|---|---|---|
| 1 | $2.40 | $5.00 | **$7.40** |
| 2 | $4.50 | $5.90 | **$10.40** |
| 3 | $6.60 | $7.30 | **$13.90** |
| 4 | $8.70 | $9.00 | **$17.70** |

Four numbers off the **Total** column. Cost and freight already combined.

Two things follow, and both were wrong in the earlier version of this page.

**Totals are never linear.** Two units cost $10.40, not $14.80. Four cost
$17.70, not $29.60. The supplier has already priced freight at volume, so a
single per-unit cost multiplied by quantity overstates every bundle. The
implied per-unit cost across this quote falls **$7.40 → $5.20 → $4.63 →
$4.43**, a 40% volume discount you receive before discounting anything
yourself.

**The Total already includes delivery.** A separate shipping field would
count freight twice. That is why **Your extra per order** defaults to zero
and means only what the quote does *not* cover: your own packaging,
pick-and-pack, insert cards.

**You no longer enter a CPA.** It is solved from the landed cost of the pack
and tier you select: **Target CPA** (the cost cap to give Meta, keeps 20%) and
**Break-even CPA** (the kill line). Landed cost decides what you can *afford*
to pay for a customer; it cannot decide what Meta *charges*. So every row is
checked against one store-level constant, `TRAFFIC_FLOOR_CPA` in `tiers.ts`
($20, matching Launchpad's test target CPA). Replace that constant with the
observed CPA once a test has about 30 orders.

### What became a constant

Set once per store, not per product. The Compare view takes GST, return
assumptions and retained margin from `DEFAULT_COSTS` in `tiers.ts`, and
card mix from `DEFAULT_FEES` in `shopify-fees.ts`. The full model also
supports the scaling assumptions below. There is no page-local `BAKED` copy.

| Baked value | Default |
|---|---|
| GST rate | 0% — the store operates without GST |
| Card mix | 85% domestic / 5% Amex / 10% international |
| Extra fee points (Afterpay, FX, chargebacks) | 0 |
| Third-party gateway | off |
| Margin to keep after ads | 20% |
| Ecom overhead per day | $50 |
| Supplier lead time | 45 days |
| CPA climb per doubling of spend | 15% |

There is no market-price field, so nothing is flagged *Above market*. The
page can tell you a price is unaffordable at your CPA; whether customers
would pay it is your call.

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

## Bundles: buy 1, 2, 3, 4

Bundle size is a **second axis**, not three more rungs on the quality ladder.
The quality tier sets the single-unit price. The bundle axis multiplies it.

### Why bundles work, precisely

A four-pack against four separate orders saves about **$17** of shipping and
flat transaction fees. It also saves **three CPAs — about $85**.

So roughly **83% of a bundle's advantage is simply not buying the customer
again.** Bundles are an acquisition-cost play. Almost everyone sells them as
a fulfilment-efficiency play, which is the small half.

Three costs do not multiply with units: the parcel base, the flat 30c, and
the CPA. Everything else does.

### Prices are solved, discounts are reported

Every pack is priced from its own line on the quote, all to the same
before-ads margin. So the discount is an **output** — what the offer works
out to be, not a number anyone guessed:

| Offer | Quote | Price | Per unit | Offer reads | Needs for CPA | Target CPA |
|---|---|---|---|---|---|---|
| Buy 1 | $7.40 | $27.48 | $27.48 | — | $47.44 | $11.24 |
| Buy 2 | $10.40 | $38.19 | $19.10 | 31% off | $51.79 | $15.62 |
| Buy 3 | $13.90 | $50.68 | $16.89 | 39% off | $56.87 | $20.73 |
| Buy 4 | $17.70 | $64.25 | $16.06 | 42% off | $62.39 | $26.28 |

**Max cut** is how much further a pack could go before it earns less than
selling one unit. On this quote: 42% / 55% / 61%.

### Two constraints, and the higher one binds

A margin tier gives the **minimum viable price**. It does not know what
traffic costs, so on a cheap product it prices far too low: a $7.40 bottle
satisfies a 65% before-ads margin at $27.48, which cannot fund a $25 CPA.

**Needs for CPA** is the other constraint — the price a pack must reach to
fund the traffic you are buying. In the table above only Buy 4 has a tier
price ($64.25) above what the CPA needs ($62.39), which is why it is the only
pack that stands alone.

This is the failure a healthy-looking margin hides, and the page states it
rather than leaving you to notice.

### Why each extra unit is nearly all profit

The marginal cost of each added unit is tiny: unit two adds **$3.00**, unit
three **$3.50**, unit four **$3.80**. At the buy-4 price of $16.06 a unit,
about **76%** of every extra unit sold is contribution.

That, plus paying one CPA instead of four, is the entire case for the ladder.


### The take-rate mix

**This is the number nobody has and everything depends on.** CPA is charged
per order, and every order is one rung of the ladder, so the only CPA worth
judging ads against is the take-rate-weighted one.

At an all-singles mix the blended target CPA equals the one-pack's exactly,
and bundles change nothing at all. At 40% multi-unit it rises about 1.45x. At
a heavy 80% multi mix it roughly doubles.

The sensitivity chart plots blended target CPA against the share of orders
taking two or more units, with a flat line at the CPA you actually pay. Where
the curve crosses that line is the take rate this offer needs to work.

### The trap

**Bundles make the profit problem better and the cash problem worse, at the
same time and for the same reason.** Four units per order is four times the
stock. The scale panel and the stock-cash figure both run on blended units
per order, so you can see the two moving together: a heavy multi mix can lift
daily profit and simultaneously push required inventory cash past anything
the business can fund.

### Honest limits on the bundle model

- **Same SKU only.** Buy-2/3/4 are multi-buys of one product. A mixed bundle
  of different products needs a per-component landed cost and is not
  modelled.
- **Your extra per order is the input that flatters bundles.** It defaults
  to zero because a landed-and-delivered quote already covers freight. If
  your quote does not, and you leave it at zero, every pack reads better than
  it is.
- **CPA is flat across the mix.** That holds when the ad sells the entry
  offer and the bundle is an on-site upsell. If you advertise the bundle
  itself, conversion falls and CPA rises, and the model will flatter you.
- **Partial returns are not modelled.** A customer keeping two of four is
  common and the loss-per-return figure cannot express it.
- **The discount that clears is set by your landed-cost share, not by what
  competitors advertise.** On a low-COGS product a 3-pack at 30% off still
  gains. On a high-COGS product the identical offer can push per-unit
  contribution below the single. There is a test for exactly this in
  `bundles.test.ts`.

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
- `app/lib/ecom/tiers.ts` — the single-unit ladder, the floor, the scaling curve
- `app/lib/ecom/bundles.ts` — the quote model, the price solver, the blend
- `app/lib/ecom/tiers.test.ts` and `bundles.test.ts` — 43 checks, run by `npm test`

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
