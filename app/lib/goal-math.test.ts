import {test} from 'node:test';
import assert from 'node:assert/strict';
import {entryProfit,weekBounds} from './goal-math.ts';

const t={id:'x',name:'Omega X',status:'Live',launch_date:null,created_at:'',fee_pct:0.029,fee_fixed:0.3,bundles_config:[{id:1,cogs:7.3},{id:2,cogs:10.6},{id:3,cogs:13.8}]};
test('profit uses the bundle mix, then card fees',()=>{
 const p=entryProfit({entry_date:'2026-10-29',orders:12,revenue:579.85,meta_spend:177.66,profit_snapshot:null,bundle_breakdown:[{bundle_id:1,count:8},{bundle_id:2,count:3},{bundle_id:3,count:1}]},t);
 assert.equal(Math.round(p*100)/100,Math.round((579.85-177.66-(8*7.3+3*10.6+13.8)-579.85*0.029-12*0.3)*100)/100);
});
test('Launchpad cost snapshot wins when present',()=>{
 assert.equal(entryProfit({entry_date:'d',orders:2,revenue:100,meta_spend:40,bundle_breakdown:null,profit_snapshot:{cogs:10,fees:3,refunds:5}},t),42);
});
test('no bundle mix: cheapest bundle per order',()=>{
 assert.equal(Math.round(entryProfit({entry_date:'d',orders:1,revenue:50,meta_spend:0,bundle_breakdown:null,profit_snapshot:null},{...t,fee_pct:0,fee_fixed:0})*10)/10,42.7);
});
test('Melbourne week starts Monday',()=>{
 assert.deepEqual(weekBounds(new Date('2026-11-03T03:00:00Z')),{mon:'2026-11-02',lastMon:'2026-10-26'});
 // Sunday 8 Nov 11pm Melbourne is still the week of 2 Nov
 assert.equal(weekBounds(new Date('2026-11-08T12:00:00Z')).mon,'2026-11-02');
 // Monday 9 Nov 1am Melbourne (Sun 14:00 UTC) is the new week
 assert.equal(weekBounds(new Date('2026-11-08T14:00:00Z')).mon,'2026-11-09');
});
