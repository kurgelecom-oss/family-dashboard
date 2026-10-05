import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {calculateOffers,offerAtPrice,mixForTake,blendOffers,takeNeeded,TIERS,ASSUMPTIONS} from '../public/offer-model.mjs';
import {row,solvePrice} from '../app/lib/ecom/bundles.ts';
import {DEFAULT_FEES} from '../app/lib/ecom/shopify-fees.ts';
const close=(actual,expected)=>{
 if(!Number.isFinite(expected)){assert.equal(actual,expected);return;}
 assert.ok(Math.abs(actual-expected)<1e-8,`${actual} differs from ${expected}`);
};
test('Compare prices preserve canonical supplier-pack maths across plans, packs, returns and extras',()=>{
 const totals=[7.4,10.4,13.9,17.7];
 for(const plan of ['basic','grow','advanced'])for(const scenario of [
  {retPct:8,retLossPct:25,extraPerOrder:0,cpa:12},
  {retPct:0,retLossPct:0,extraPerOrder:3,cpa:0},
  {retPct:20,retLossPct:50,extraPerOrder:2.5,cpa:30},
  {retPct:100,retLossPct:100,extraPerOrder:0,cpa:12},
 ]){
  const sc={totals,...scenario,gstPct:0,keepPct:20,fees:{...DEFAULT_FEES,plan}};
  for(let units=1;units<=4;units++){
   const results=calculateOffers({cost:totals[units-1],plan,...scenario});
   TIERS.forEach((tier,i)=>{
    const p1=solvePrice(tier.before,1,sc);
    const expected=row(tier.before,units,sc,p1,1,scenario.cpa),actual=results[i];
    close(actual.price,expected.price);
    assert.equal(actual.unreachable,expected.unreachable);
    if(!expected.unreachable){
     close(actual.targetCpa,expected.targetCpa);
     close(actual.profit,expected.before-scenario.cpa);
     close(actual.floor,expected.cpaFundedPrice);
     close(actual.gst,expected.gst);
     close(actual.fee,expected.fee);
     close(actual.returns,expected.returns);
     assert.equal(actual.fundsCpa,expected.fundsCpa);
    }
   });
  }
 }
});
test('bundle cost is a delivered pack total, without multiplying it or adding shipping',()=>{
 const single=calculateOffers({cost:7.4,cpa:12})[0];
 const two=calculateOffers({cost:10.4,cpa:12})[0];
 assert.ok(two.price<single.price*2);
 close(two.net-10.4-two.fee-two.returns-12,two.profit);
 close(two.price/single.price,(10.4+.3)/(7.4+.3));
});
test('every quoted price accounts for all deductions and the retained amount',()=>{
 for(const cost of [0,7.4,10.4,13.9,17.7,100000])for(const offer of calculateOffers({cost,cpa:12,extraPerOrder:2})){
  close(offer.price,cost+2+offer.gst+offer.fee+offer.returns+12+offer.profit);
 }
});
const CAP=ASSUMPTIONS.floorCpa;
test('the customer cost is the rulebook planning CPA',()=>{
 // Only checkable where the rulebook is on disk (tk's Mac); the deploy build has no copy.
 const gates=process.env.HOME+'/Projects/mission-control-web/src/lib/radar/gates.json';
 if(!existsSync(gates))return;
 assert.equal(CAP,JSON.parse(readFileSync(gates,'utf8')).direct_path.planning_cpa_usd);
});
test('CPA is solved from landed cost alone and judged against the planning CPA',()=>{
 const [excellent,,,poor]=calculateOffers({cost:7.4});
 close(excellent.kept,0.2*excellent.net);
 close(excellent.gst,0);close(excellent.net,excellent.price); // no GST: the retail price is the revenue
 assert.ok(excellent.breakEvenCpa>excellent.targetCpa);
 close(excellent.roasNeeded,excellent.price/excellent.targetCpa);
 assert.equal(excellent.fundsCpa,false); // a $7.40 pack cannot buy a $45 customer at any margin row
 assert.equal(calculateOffers({cost:33})[0].fundsCpa,true);
 assert.ok(poor.targetCpa<3);
});
test('verdict grades each offer on dollars, and the fixes it names really fix it',()=>{
 const rows=calculateOffers({cost:33});
 assert.deepEqual(rows.map(r=>r.verdict),['good','bad','bad','bad']);
 assert.deepEqual(calculateOffers({cost:25}).map(r=>r.verdict),['tight','bad','bad','bad']);
 for(const r of rows){
  // The floor price funds exactly the planning CPA while keeping 20%.
  close(calculateOffers({cost:33,cpa:CAP})[0].floor,r.floor);
  close(r.floorMargin,0.2+CAP/r.floor);
  // At maxCost the same retail price funds exactly the planning CPA.
  if(r.maxCost>0){const fixed=calculateOffers({cost:r.maxCost}).find(x=>Math.abs(x.floor-r.price)<1e-6);assert.ok(fixed,'price equals the floor at maxCost');}
 }
});
test('a typed price is graded by the same maths as a solved one',()=>{
 for(const tier of calculateOffers({cost:13.9})){
  const typed=offerAtPrice({cost:13.9,price:tier.price});
  for(const k of ['price','targetCpa','breakEvenCpa','profit','fee','returns','floor'])close(typed[k],tier[k]);
  assert.equal(typed.verdict,tier.verdict);assert.equal(typed.tierPct,tier.tierPct);
 }
 const cheap=offerAtPrice({cost:13.9,price:19.95}),dear=offerAtPrice({cost:13.9,price:99.95});
 close(cheap.price,19.95);close(dear.price,99.95);
 assert.equal(cheap.verdict,'bad');assert.equal(dear.verdict,'good');
 assert.ok(offerAtPrice({cost:13.9,price:10}).tierPct<0); // below cost: a negative margin, not a crash
});
test('the Omega X ladder reads the way the rulebook says it should',()=>{
 // Launchpad row, 5 Oct 2026: landed 9.40 / 12.40 / 15.90, prices 49.95 / 79.95 / 99.95.
 const v=[[9.4,49.95],[12.4,79.95],[15.9,99.95]].map(([cost,price])=>offerAtPrice({cost,price}).verdict);
 assert.deepEqual(v,['bad','good','good']); // the single cannot buy a customer; the bundles can
});
test('the offer as a whole is the take-weighted order, and the take it names is the take it needs',()=>{
 const units=[1,2,3],offers=[[8.9,39.99],[11.9,69.99],[15.4,89.99]].map(([cost,price])=>offerAtPrice({cost,price}));
 assert.deepEqual(mixForTake([1],0.5),[1]);
 assert.deepEqual(mixForTake(units,0),[1,0,0]);
 close(mixForTake(units,0.55).reduce((a,b)=>a+b,0),1);
 close(mixForTake(units,0.55)[1],0.4);close(mixForTake(units,0.55)[2],0.15); // CLEO's expected mix
 const alone=blendOffers(offers,mixForTake(units,0));
 close(alone.breakEvenCpa,offers[0].breakEvenCpa);assert.equal(alone.verdict,'bad'); // a $39.99 single cannot buy a $45 customer
 for(const key of ['breakEvenCpa','targetCpa']){
  const need=takeNeeded(units,offers,key);
  assert.ok(need>0&&need<1);
  close(blendOffers(offers,mixForTake(units,need))[key],CAP); // at that take the blend lands exactly on the planning CPA
 }
 assert.equal(blendOffers(offers,mixForTake(units,1)).verdict,'good');
 assert.equal(takeNeeded([1,2],[offerAtPrice({cost:8.9,price:19.99}),offerAtPrice({cost:11.9,price:29.99})],'breakEvenCpa'),null);
 assert.equal(takeNeeded([1],[offers[0]],'breakEvenCpa'),null);
});
