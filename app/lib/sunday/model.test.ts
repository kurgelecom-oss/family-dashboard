import {test} from 'node:test';
import assert from 'node:assert/strict';
import {civilDay,weekFor,viewFor,quranWeek,parseManual,inWeek,mergeCount} from './model.ts';
import {cyclePayload,parseCycleChange} from '../cycle-state.ts';
test('Sunday only, Melbourne midnight and DST',()=>{
 assert.equal(civilDay(new Date('2026-09-12T14:01:00Z')),'2026-09-13');
 assert.equal(civilDay(new Date('2026-10-04T13:01:00Z')),'2026-10-05');
 for(let d=7;d<=13;d++)assert.equal(viewFor(`2026-09-${d.toString().padStart(2,'0')}`),d===13?'weekly':'daily');
 assert.equal(viewFor('2026-09-13',{day:'2026-09-13',mode:'daily'}),'daily');
 assert.equal(viewFor('2026-09-14',{day:'2026-09-13',mode:'weekly'}),'daily');
 assert.equal(viewFor('2026-09-09',{day:'2026-09-09',mode:'weekly'}),'weekly');
 assert.deepEqual(weekFor('2026-09-13').days,['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13']);
});
test('Quran counts finished sessions, distinct days, excludes future and adjacent weeks',()=>{
 const r=quranWeek([{date:'2026-09-07',finished:true,minutes:10},{date:'2026-09-07',finished:true,minutes:20},{date:'2026-09-08',finished:false},{date:'2026-09-10',finished:true},{date:'2026-09-06',finished:true}],weekFor('2026-09-09').days,'2026-09-09');
 assert.equal(r.totalDays,1);assert.equal(r.sessions,2);assert.equal(r.minutes,30);assert.equal(r.days[3].future,true);
});
test('period stays on for short, long and overdue durations until manually ended',()=>{
 for(const today of ['2026-09-12','2026-09-21','2026-10-20'])assert.equal(cyclePayload({active:true,startedOn:'2026-09-11',endedOn:null,version:1},today).active,true);
 assert.equal(cyclePayload({active:false,startedOn:'2026-09-11',endedOn:'2026-09-13',version:2},'2026-09-13').activeDay,null);
 assert.equal(cyclePayload({active:true,startedOn:'2026-09-11',endedOn:null,version:1},'2026-09-13').totalDays,null);
 assert.throws(()=>parseCycleChange({active:'false',version:1}));
});
test('manual values validate identity, week, bounds and zero',()=>{
 const b={mode:'fallback',weekStart:'2026-09-07',member:'ansar',metric:'sleep',value:0,note:'',version:0};
 assert.equal(parseManual(b,'2026-09-13').value,0);
 for(const p of [{value:8},{value:-1},{value:1.5},{member:'ayah'},{weekStart:'2026-09-08'},{weekStart:'2026-09-14'},{weekStart:'2026-02-30'}])assert.throws(()=>parseManual({...b,...p},'2026-09-13'));
 assert.equal(inWeek('2026-09-06T15:00:00Z','2026-09-07','2026-09-13'),true);
});

test('recovered feeds never double-count a fallback total',()=>{
 assert.deepEqual(mergeCount(null,{value:5,mode:'fallback'}),{value:5,source:'manual',backupIgnored:false});
 assert.deepEqual(mergeCount(5,{value:5,mode:'fallback'}),{value:5,source:'auto',backupIgnored:true});
 assert.deepEqual(mergeCount(5,{value:2,mode:'supplement'}),{value:7,source:'mixed',backupIgnored:false});
 assert.equal(mergeCount(null,{value:2,mode:'supplement'}).value,null);
 assert.equal(mergeCount(null).value,null);assert.equal(mergeCount(0).value,0);
});
