import {test} from 'node:test';
import assert from 'node:assert/strict';
import {surfaceLogWeek} from './surface-log.ts';
import {weekFor} from './model.ts';
const week=weekFor('2026-09-13');
const row=(id:string,name:string,submitted:string|null,created='2026-09-09T00:58:00.000Z')=>({id,created_time:created,properties:{'Product Name':{title:[{plain_text:name}]},'Submission Date':{date:submitted?{start:submitted}:null}}});

test('counts Nihal’s dated surface records without requiring an owner property',()=>{
 const result=surfaceLogWeek([
  row('magnesium','Magnesium 12-in-1 Complex','2026-09-09T00:58:00.000+00:00'),
  row('kombucha','Probiotic Kombucha Gummies','2026-09-08T03:31:00.000+00:00'),
 ],week,'2026-09-13');
 assert.equal(result?.total,2);
 assert.deepEqual(result?.daily.map(d=>d.count),[0,1,1,0,0,0,0]);
 assert.deepEqual(result?.entries.map(e=>[e.name,e.date,e.timestamp]),[
  ['Probiotic Kombucha Gummies','2026-09-08','2026-09-08T03:31:00.000+00:00'],
  ['Magnesium 12-in-1 Complex','2026-09-09','2026-09-09T00:58:00.000+00:00'],
 ]);
});

test('uses Melbourne week boundaries and excludes dates after the report cutoff',()=>{
 const result=surfaceLogWeek([
  row('before','Before week','2026-09-06T13:59:00Z'),
  row('start','Monday midnight','2026-09-06T14:00:00Z'),
  row('cutoff','Wednesday','2026-09-09'),
  row('future','Thursday','2026-09-09T14:00:00Z'),
  row('after','Next Monday','2026-09-13T14:00:00Z'),
 ],week,'2026-09-09');
 assert.deepEqual(result?.entries.map(e=>e.id),['start','cutoff']);
 assert.deepEqual(result?.daily.map(d=>d.count),[1,0,1,null,null,null,null]);
 const dst=surfaceLogWeek([row('dst','After DST','2026-10-04T13:00:00Z')],weekFor('2026-10-05'),'2026-10-05');
 assert.equal(dst?.entries[0].date,'2026-10-05');
});

test('prefers submission date over import time and uses creation only for missing dates',()=>{
 const result=surfaceLogWeek([
  row('imported','Imported old product','2025-05-25T00:58:00Z'),
  row('fallback','Missing submission date',null,'2026-09-08T03:31:00Z'),
  row('date-only','Date without time','2026-09-09'),
  row('invalid','Bad date','not-a-date'),
 ],week,'2026-09-13');
 assert.deepEqual(result?.entries.map(e=>e.id),['fallback','date-only']);
 assert.equal(result?.entries[0].dateSource,'Created time');
 assert.equal(result?.entries[1].timestamp,null);
});

test('distinguishes an unavailable feed from zero and counts each Notion record once',()=>{
 assert.equal(surfaceLogWeek(null,week,'2026-09-13'),null);
 assert.equal(surfaceLogWeek([],week,'2026-09-13')?.total,0);
 const record=row('one','Same product name','2026-09-08');
 const result=surfaceLogWeek([record,record,row('two','Same product name','2026-09-09'),row('blank','  ','2026-09-09')],week,'2026-09-13');
 assert.equal(result?.total,2);
});
