import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AU_RATES, blended, effectivePct, feeOn, normalise, DEFAULT_FEES, type FeeConfig} from './shopify-fees.ts';
import {TIERS, DEFAULT_COSTS, priceFor, rung, ladder, minViablePrice, returnRate,
 cpaAtSpend, scalePoint, peakSpend, type Costs} from './tiers.ts';

const near=(a:number,b:number,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} !~ ${b}`);

/* ── fee engine ─────────────────────────────────────────────────────────── */

test('published AU rates are wired to the right plans',()=>{
 near(AU_RATES.basic.domestic.pct,1.75);
 near(AU_RATES.grow.domestic.pct,1.6);
 near(AU_RATES.advanced.domestic.pct,1.4);
 near(AU_RATES.basic.international.pct,3.5);
 // Every plan charges the same 30c, so the fixed cent is plan-independent.
 for(const p of ['basic','grow','advanced'] as const) near(AU_RATES[p].domestic.fixed,0.30);
});

test('the fixed 30c makes cheap orders cost more in percentage terms',()=>{
 const cheap = effectivePct(14, DEFAULT_FEES);
 const dear  = effectivePct(140, DEFAULT_FEES);
 assert.ok(cheap > dear, `${cheap} should exceed ${dear}`);
 // This is the whole reason the engine exists: over a point of difference.
 assert.ok(cheap - dear > 1.5);
});

test('card mix is normalised, so UI drift cannot scale the fee',()=>{
 const m = normalise({domestic:85, amex:5, international:10});
 near(m.domestic+m.amex+m.international,1);
 const a = blended({...DEFAULT_FEES, mix:{domestic:85,amex:5,international:10}});
 const b = blended({...DEFAULT_FEES, mix:{domestic:0.85,amex:0.05,international:0.10}});
 near(a.pct,b.pct);
 // A zeroed mix falls back rather than dividing by zero.
 assert.ok(isFinite(blended({...DEFAULT_FEES, mix:{domestic:0,amex:0,international:0}}).pct));
});

test('an international-heavy mix and a third-party gateway both cost more',()=>{
 const base = blended(DEFAULT_FEES).pct;
 const intl = blended({...DEFAULT_FEES, mix:{domestic:0.2,amex:0.05,international:0.75}}).pct;
 const gw: FeeConfig = {...DEFAULT_FEES, thirdParty:true};
 assert.ok(intl > base);
 near(blended(gw).pct - base, AU_RATES.basic.thirdPartySurchargePct);
});

test('a better plan is cheaper at the same order value',()=>{
 const basic = feeOn(80,{...DEFAULT_FEES,plan:'basic'});
 const adv   = feeOn(80,{...DEFAULT_FEES,plan:'advanced'});
 assert.ok(adv < basic);
});

/* ── the ladder ─────────────────────────────────────────────────────────── */

test('every solved price round-trips to its own tier target',()=>{
 for(const t of TIERS){
  const r = rung(t, DEFAULT_COSTS);
  assert.ok(isFinite(r.price), `${t.key} should be reachable on the defaults`);
  near(r.before/r.netRev, t.before, 1e-9);
 }
});

test('better tiers cost more and leave more for traffic',()=>{
 const [exc,good,avg,poor] = ladder(DEFAULT_COSTS);
 assert.ok(exc.price > good.price);
 assert.ok(good.price > avg.price);
 assert.ok(avg.price > poor.price);
 assert.ok(exc.targetCpa > good.targetCpa);
 assert.ok(good.targetCpa > avg.targetCpa);
 assert.ok(avg.targetCpa > poor.targetCpa);
});

test('GST is removed from revenue, not treated as income',()=>{
 const withGst = rung(TIERS[1], {...DEFAULT_COSTS, gstPct:10});
 const noGst   = rung(TIERS[1], {...DEFAULT_COSTS, gstPct:0});
 // Same target margin, but a GST-registered seller must charge more to reach it.
 assert.ok(withGst.price > noGst.price);
 near(withGst.netRev, withGst.price/1.1, 1e-9);
 near(withGst.gst, withGst.price - withGst.netRev, 1e-9);
 near(noGst.gst, 0);
});

test('break-even CPA equals everything left before ads',()=>{
 const r = rung(TIERS[0], DEFAULT_COSTS);
 near(r.breakEvenCpa, r.before);
 near(r.before, r.netRev - DEFAULT_COSTS.cogs - DEFAULT_COSTS.ship - r.fee - r.returns, 1e-9);
 // The target CPA is strictly below break-even because it keeps a margin.
 assert.ok(r.targetCpa < r.breakEvenCpa);
 near(r.breakEvenCpa - r.targetCpa, DEFAULT_COSTS.keepPct/100 * r.netRev, 1e-9);
});

test('paying exactly the target CPA leaves exactly the margin asked for',()=>{
 const r = rung(TIERS[1], DEFAULT_COSTS);
 const kept = r.before - r.targetCpa;
 near(kept/r.netRev*100, DEFAULT_COSTS.keepPct, 1e-9);
});

test('a dearer supplier pushes every price up and no tier silently improves',()=>{
 const cheap = ladder(DEFAULT_COSTS);
 const dear  = ladder({...DEFAULT_COSTS, cogs:DEFAULT_COSTS.cogs*2});
 cheap.forEach((c,i)=>{
  assert.ok(dear[i].price > c.price);
  near(dear[i].before/dear[i].netRev, c.before/c.netRev, 1e-9);
 });
});

test('an impossible cost base reports unreachable instead of a fantasy price',()=>{
 // Returns alone eat more than the tier target leaves.
 const hopeless:Costs = {...DEFAULT_COSTS, retPct:90, retLossPct:90};
 assert.ok(returnRate(hopeless) > 0.65);
 assert.equal(priceFor(TIERS[0].before, hopeless), Infinity);
 const r = rung(TIERS[0], hopeless);
 assert.ok(r.unreachable);
 assert.equal(r.price, Infinity);
});

test('a market price marks the rungs the market will not bear',()=>{
 const l = ladder(DEFAULT_COSTS, 0);
 assert.ok(l.every(r=>!r.aboveMarket), 'no market price means no judgement');
 const capped = ladder(DEFAULT_COSTS, l[2].price);   // market pays the Average price
 assert.ok(capped[0].aboveMarket, 'Excellent should be out of reach');
 assert.ok(capped[1].aboveMarket, 'Good should be out of reach');
 assert.ok(!capped[2].aboveMarket);
 assert.ok(!capped[3].aboveMarket);
});

test('the minimum viable price rises with the CPA you must pay',()=>{
 const at10 = minViablePrice(10, DEFAULT_COSTS);
 const at40 = minViablePrice(40, DEFAULT_COSTS);
 assert.ok(at40 > at10);
 // At that exact price the target CPA is affordable and nothing is left over.
 const g = DEFAULT_COSTS.gstPct/100;
 const net = at40/(1+g);
 const kept = net - DEFAULT_COSTS.cogs - DEFAULT_COSTS.ship
   - feeOn(at40, DEFAULT_COSTS.fees) - returnRate(DEFAULT_COSTS)*net - 40;
 near(kept/net*100, DEFAULT_COSTS.keepPct, 1e-6);
});

/* ── scaling ────────────────────────────────────────────────────────────── */

test('CPA only climbs with spend when elasticity is switched on',()=>{
 near(cpaAtSpend(20,100,5000,0),20);
 assert.ok(cpaAtSpend(20,100,5000,0.15) > 20);
 // Doubling the exponent raises the climb.
 assert.ok(cpaAtSpend(20,100,5000,0.30) > cpaAtSpend(20,100,5000,0.15));
 near(cpaAtSpend(20,100,100,0.15),20);
});

test('spending more is not the same as earning more once CPA climbs',()=>{
 const r = rung(TIERS[2], DEFAULT_COSTS);
 const opts = {baseCpa:r.targetCpa, baseSpend:100, elasticity:0.20, fixedPerDay:150, leadDays:45};
 const small = scalePoint(r, DEFAULT_COSTS, 50, opts);
 const big   = scalePoint(r, DEFAULT_COSTS, 5000, opts);
 assert.ok(big.revenue > small.revenue, 'revenue still grows');
 assert.ok(big.cpa > small.cpa, 'but each customer costs more');
 const peak = peakSpend(r, DEFAULT_COSTS, opts);
 assert.ok(peak.spend > 0 && peak.spend < 5000, `peak should sit inside the range, got ${peak.spend}`);
 assert.ok(peak.profit >= small.profit && peak.profit >= big.profit);
});

test('with no CPA climb the curve never turns down',()=>{
 const r = rung(TIERS[0], DEFAULT_COSTS);
 const opts = {baseCpa:r.targetCpa, baseSpend:100, elasticity:0, fixedPerDay:0, leadDays:0};
 const peak = peakSpend(r, DEFAULT_COSTS, opts, 5000, 100);
 near(peak.spend, 5000, 1e-9);
});

test('stock cash grows with run rate and lead time, which profit alone hides',()=>{
 const r = rung(TIERS[1], DEFAULT_COSTS);
 const opts = {baseCpa:r.targetCpa, baseSpend:100, elasticity:0.15, fixedPerDay:0, leadDays:45};
 const p = scalePoint(r, DEFAULT_COSTS, 2000, opts);
 near(p.stockCash, p.orders*DEFAULT_COSTS.cogs*45, 1e-9);
 const shorter = scalePoint(r, DEFAULT_COSTS, 2000, {...opts, leadDays:15});
 assert.ok(shorter.stockCash < p.stockCash);
 // The trap: a day's profit is small next to the cash the stock demands.
 assert.ok(p.stockCash > p.profit);
});

test('a rung can be excellent on margin and still unaffordable at market CPA',()=>{
 // Cheap product, heavy fulfilment: margins look superb, CPAs do not clear.
 const c:Costs = {...DEFAULT_COSTS, cogs:6};
 const marketCpa = 32;                       // all-ecom Meta average, USD-sourced
 const l = ladder(c, 0, marketCpa);
 assert.ok(l[0].grossMarginPct > 80, 'Excellent looks superb on gross margin');
 assert.ok(l.every(r=>r.cpaShort), 'yet no rung funds a $32 CPA');
 assert.ok(l.every(r=>!r.viable));
 // The fix is price, and minViablePrice says how much.
 const need = minViablePrice(marketCpa, c);
 assert.ok(need > l[0].price, 'the viable price sits above even the Excellent rung');
 const fixed = rung(TIERS[0], c, 0, marketCpa);
 assert.ok(fixed.cpaHeadroom < 0);
});

test('no actual CPA supplied means no CPA judgement',()=>{
 const l = ladder(DEFAULT_COSTS, 0, 0);
 assert.ok(l.every(r=>!r.cpaShort));
 assert.ok(l.every(r=>Number.isNaN(r.cpaHeadroom)));
 assert.ok(l.every(r=>r.viable), 'viable until something contradicts it');
});

test('viability needs the market AND the CPA to agree',()=>{
 const c:Costs = {...DEFAULT_COSTS, cogs:25};
 const good = rung(TIERS[1], c);
 // Market pays the price and the CPA is affordable: viable.
 assert.ok(rung(TIERS[1], c, good.price + 10, good.targetCpa - 5).viable);
 // Market pays, but CPA is too dear: not viable.
 assert.ok(!rung(TIERS[1], c, good.price + 10, good.targetCpa + 5).viable);
 // CPA affordable, but market will not pay: not viable.
 assert.ok(!rung(TIERS[1], c, good.price - 10, good.targetCpa - 5).viable);
});
