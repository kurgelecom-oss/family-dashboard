import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startsNewVisit,activitySummary} from './os-activity-model.ts';

test('refreshes and active heartbeats stay in one visit, returning after 30 minutes starts another',()=>{
 const now=new Date('2026-09-13T02:30:00Z');
 assert.equal(startsNewVisit(null,'2026-09-13',now),true);
 assert.equal(startsNewVisit({day:'2026-09-13',lastSeen:'2026-09-13T02:29:00Z'},'2026-09-13',now),false);
 assert.equal(startsNewVisit({day:'2026-09-13',lastSeen:'2026-09-13T02:00:01Z'},'2026-09-13',now),false);
 assert.equal(startsNewVisit({day:'2026-09-13',lastSeen:'2026-09-13T02:00:00Z'},'2026-09-13',now),true);
});
test('Melbourne day rollover starts a new daily visit even in an existing tab',()=>{
 assert.equal(startsNewVisit({day:'2026-10-04',lastSeen:'2026-10-04T12:59:00Z'},'2026-10-05',new Date('2026-10-04T13:00:00Z')),true);
});
test('daily and weekly totals preserve untracked days and exclude future and out-of-week visits',()=>{
 const days=['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13'];
 const s=activitySummary([{day:'2026-09-06',count:9},{day:'2026-09-09',count:2},{day:'2026-09-10',count:3},{day:'2026-09-12',count:8}],days,'2026-09-10','2026-09-09');
 assert.equal(s.opensToday,3);assert.equal(s.total,5);assert.equal(s.activeDays,2);
 assert.deepEqual(s.days.map(d=>d.count),[null,null,2,3,null,null,null]);
 assert.equal(activitySummary([],days,'2026-09-10','2026-09-09').opensToday,0);
 assert.equal(activitySummary([],days,'2026-09-10',null).total,null);
});
