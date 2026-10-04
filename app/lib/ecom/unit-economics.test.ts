import {test} from 'node:test';
import assert from 'node:assert/strict';
import {model,maxCpa,priceFor,cogsCeiling,breakEvenOrders,varRate,CM_TARGET,STRESS,type Inputs} from './unit-economics.ts';

/* $59 AOV, 5% off, $14 landed, $7 fulfilment, 3.3% fees, 10% returns losing
   25% each, $22 CPA, 70% of orders from new customers. */
const B:Inputs = {price:59,discPct:5,cogs:14,ship:7,feePct:3.3,retPct:10,retLossPct:25,cpa:22,newPct:70};
const near=(a:number,b:number,t=1e-9)=>assert.ok(Math.abs(a-b)<=t,`${a} !~ ${b}`);

test('the cost stack lands on the right base',()=>{
 const m=model(B);
 near(m.netRev,59*0.95);
 near(m.fee,m.netRev*0.033);                        // fees ride net revenue, not AOV
 near(m.ret,0.10*0.25*m.netRev);                    // rate x loss share x value
 near(m.before,m.netRev-m.cogs-m.ship-m.fee-m.ret);
 near(m.acq,m.cpa*0.70);                            // repeat orders carry no CPA
 near(m.contrib,m.before-m.acq);
});

test('break-even CPA is the point where contribution is exactly zero',()=>{
 const m=model(B);
 const atBreakEven=model({...B,cpa:m.before,newPct:100});
 near(atBreakEven.contrib,0);
 near(m.beRoas,1/(m.before/m.netRev));
});

test('a product underwater before ads cannot be saved by free traffic',()=>{
 const broke=model({...B,cogs:60,cpa:0});
 assert.ok(broke.before<0);
 assert.ok(broke.contrib<0);
});

test('repeat purchase is the only lever on LTV:CAC at a fixed CPA',()=>{
 const blended=model(B);                            // 1.43 orders per customer
 const allNew=model({...B,newPct:100});             // 1.00 orders per customer
 assert.ok(blended.ltvCac>allNew.ltvCac);
 near(allNew.ordersPerCustomer,1);
 near(blended.ordersPerCustomer,1/0.7);
});

test('the stress case is never kinder than the base case',()=>{
 const m=model(B), s=model(B,true);
 assert.ok(s.contrib<m.contrib);
 assert.ok(s.before<m.before);
 near(s.cpa,B.cpa*STRESS.cpa);
 near(s.price,B.price*STRESS.price);
});

test('every solver round-trips to the target margin',()=>{
 near(model({...B,cpa:maxCpa(B)}).cmPct,CM_TARGET*100,1e-6);
 near(model({...B,price:priceFor(B)}).cmPct,CM_TARGET*100,1e-6);
 near(model({...B,cogs:cogsCeiling(B)}).cmPct,CM_TARGET*100,1e-6);
});

test('solvers report impossibility instead of a fantasy number',()=>{
 // Variable rates alone exceed what is left after the target margin.
 const hopeless:Inputs={...B,feePct:60,retPct:50,retLossPct:60};
 assert.ok(varRate(hopeless)+CM_TARGET>1);
 assert.equal(priceFor(hopeless),Infinity);
 assert.ok(cogsCeiling(hopeless)<0);
});

test('fixed costs are covered out of contribution, not revenue',()=>{
 const m=model(B);
 const orders=breakEvenOrders(B,1200);
 near(orders*m.contrib,1200,1e-6);
 assert.equal(breakEvenOrders({...B,cpa:999},1200),Infinity);
});
