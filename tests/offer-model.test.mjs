import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateOffers,TIERS} from '../public/offer-model.mjs';
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
test('CPA is solved from landed cost alone and judged against the traffic floor',()=>{
 const [excellent,,,poor]=calculateOffers({cost:7.4});
 close(excellent.kept,0.2*excellent.net);
 close(excellent.gst,0);close(excellent.net,excellent.price); // no GST: the retail price is the revenue
 assert.ok(excellent.breakEvenCpa>excellent.targetCpa);
 close(excellent.roasNeeded,excellent.price/excellent.targetCpa);
 assert.equal(excellent.fundsCpa,false); // $11.24 target cannot buy a $20 customer
 assert.equal(calculateOffers({cost:17.7})[0].fundsCpa,true);
 assert.ok(poor.targetCpa<3);
});
