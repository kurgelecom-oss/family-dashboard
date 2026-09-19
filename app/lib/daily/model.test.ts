import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ansarGroups,appliesOn,autoDone,configTasks,dayOfWeek,paceTiles,share,type HabitRow,type TaskRow} from './model.ts';
import type {WeeklyReport} from '../sunday/model.ts';

const SAT='2026-09-19',FRI='2026-09-18';
const report={
 week:{start:'2026-09-14',end:'2026-09-20',days:['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20']},
 today:SAT,through:SAT,generatedAt:'',preview:false,manual:[],sources:[],shared:{discoveries:2,validations:2,launched:1},
 people:[
  {id:'taylan',name:'Taylan',win:'',quran:{available:true,days:[{date:SAT,sessions:1,minutes:20,newAyahs:0,pages:0,future:false}],totalDays:2,sessions:2,minutes:46,newAyahs:0,pages:0},
   metrics:[{key:'validated',label:'',value:2,detail:'',source:'auto',canEdit:true,manualValue:null,manualMode:'supplement',backupIgnored:false,perDay:{[FRI]:1}},{key:'sleep',label:'',value:3,detail:'',source:'manual',canEdit:true,manualValue:3,manualMode:'fallback',backupIgnored:false}]},
  {id:'nihal',name:'Nihal',win:'',quran:{available:true,days:[{date:SAT,sessions:0,minutes:0,newAyahs:0,pages:0,future:false}],totalDays:2,sessions:2,minutes:11,newAyahs:0,pages:0},
   metrics:[{key:'discoveries',label:'',value:2,detail:'',source:'auto',canEdit:true,manualValue:null,manualMode:'supplement',backupIgnored:false,daily:[{date:SAT,count:1}],href:'https://notion.so/log'}]},
  {id:'ansar',name:'Ansar',win:'',quran:{available:true,days:[],totalDays:5,sessions:6,minutes:47,newAyahs:0,pages:0},
   metrics:[{key:'school_score',label:'',value:82,unit:'%',detail:'45 / 55 Ansar OS points · week to date',source:'auto',canEdit:false,manualValue:null,manualMode:'fallback',backupIgnored:false}]},
  {id:'ayah',name:'Ayah',win:'',quran:{available:true,days:[],totalDays:0,sessions:0,minutes:0,newAyahs:0,pages:0},metrics:[]},
 ],
} as unknown as WeeklyReport;

test('days and weekdays',()=>{
 assert.equal(dayOfWeek(SAT),6);assert.equal(dayOfWeek('2026-09-20'),7);assert.equal(dayOfWeek('2026-09-14'),1);
 assert.ok(appliesOn([],SAT));assert.ok(appliesOn(['Sat'],SAT));assert.ok(!appliesOn(['Mon','Fri'],SAT));
});

test('auto ticks read the right app for the right date',()=>{
 assert.equal(autoDone('quran','taylan',SAT,report),true);
 assert.equal(autoDone('quran','nihal',SAT,report),false);
 assert.equal(autoDone('discoveries','nihal',SAT,report),true);
 assert.equal(autoDone('validated','taylan',FRI,report),true);
 assert.equal(autoDone('validated','taylan',SAT,report),false);
 assert.equal(autoDone('quran','taylan',SAT,null),false);
});

test('config tasks: day filter, order, hand ticks, default links',()=>{
 const rows:TaskRow[]=[
  {id:'b',member:'nihal',title:'Up at first waking',order:2,days:['Sat'],feeds:'Back to sleep',auto:null,link:null},
  {id:'a',member:'nihal',title:'Find one product',order:1,days:[],feeds:'Products found',auto:'discoveries',link:null},
  {id:'c',member:'nihal',title:'Weekday only',order:3,days:['Mon'],feeds:'',auto:null,link:null},
  {id:'d',member:'taylan',title:'Not hers',order:1,days:[],feeds:'',auto:null,link:null},
 ];
 const list=configTasks('nihal',SAT,rows,report,new Set(['b']));
 assert.deepEqual(list.map(t=>t.id),['a','b']);
 assert.equal(list[0].done,true);assert.equal(list[0].auto,true);assert.equal(list[0].href,'https://notion.so/log');
 assert.equal(list[1].done,true);assert.equal(list[1].source,'tap');
});

test('Ansar: big blocks collapse to a count, small blocks list each habit',()=>{
 const h=(id:string,block:string,order:number,days:string[]=['Sat']):HabitRow=>({id,name:id,block,order,days});
 const habits=[...['m1','m2','m3','m4','m5'].map((id,i)=>h(id,'pre',i)),h('push_strength','push',9),h('push_engine','push',10),h('push_quran','push',11),h('weekday','school',1,['Mon'])];
 const groups=ansarGroups(SAT,habits,new Set(['m1','m2','push_strength']));
 assert.deepEqual(groups.map(g=>g.name),['Habits','Saturday Push']);
 assert.equal(groups[0].tasks[0].count,'2 / 5');assert.equal(groups[0].tasks[0].done,false);
 assert.deepEqual(groups[1].tasks.map(t=>[t.id,t.done]),[['push_strength',true],['push_engine',false],['push_quran',false]]);
 assert.equal(share(groups),1/4);
 assert.equal(share([]),null);
});

test('pace tiles judge against an even pace through the week',()=>{
 const t=Object.fromEntries(paceTiles(report,SAT).map(x=>[x.key,x]));
 assert.equal(t.quran.value,'9');assert.equal(t.quran.of,'/ 28');assert.equal(t.quran.stateLabel,'Behind');
 assert.equal(t.launched.stateLabel,'Done ✓');
 assert.equal(t.ansar.value,'82%');assert.equal(t.ansar.stateLabel,'Saturday unlocked');
 assert.equal(t.sleep.value,'3');assert.equal(t.sleep.stateLabel,'Aim for 0');
 assert.deepEqual(paceTiles(null,SAT),[]);
});
