/* eslint-disable @typescript-eslint/no-explicit-any -- scene lookups in assertions */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildStory,showedUp,didLines} from './model.ts';
import {statsEmail,reminderEmail} from './email.ts';
import {weekFor,quranWeek,type WeeklyReport,type PersonReport,type Metric} from '../sunday/model.ts';
const week=weekFor('2026-10-14'),through='2026-10-14'; // Mon 12 – Wed 14 so far: 3 days
const m=(key:Metric['key'],value:number|null,extra:Partial<Metric>={}):Metric=>({key,label:key,value,detail:'',source:'auto',canEdit:false,manualValue:null,manualMode:'fallback',backupIgnored:false,...extra});
const person=(id:PersonReport['id'],quranDates:string[],metrics:Metric[],win=''):PersonReport=>({id,name:id[0].toUpperCase()+id.slice(1),quran:quranWeek(quranDates.map(date=>({date,finished:true,minutes:10,newAyahs:2})),week.days,through),metrics,win});
const report:WeeklyReport={week,today:through,through,generatedAt:'2026-10-14T08:00:00Z',preview:false,manual:[],sources:[{id:'ads',label:'custm Meta ads',state:'unavailable',detail:'',href:''}],shared:{discoveries:2,validations:1,launched:0},people:[
 person('taylan',['2026-10-12'],[m('validated',1,{perDay:{'2026-10-13':1}}),m('launched',0),m('ad_leads',null),m('ad_spend',null)],'Launch one product'),
 person('nihal',['2026-10-12','2026-10-13','2026-10-14'],[m('discoveries',2,{daily:[{date:'2026-10-12',count:2}]}),m('mentorship',1),m('os_opens',4,{daily:[{date:'2026-10-14',count:4},{date:'2026-10-15',count:null}]})]),
 person('ansar',[],[m('school_score',80),m('school_work',3,{perDay:{'2026-10-13':3}})]),
 person('ayah',[],[]),
]};
const sc=buildStory(report),get=(id:string)=>sc.find(s=>s.id===id) as any;
test('eight scenes, goals first, next last',()=>{assert.equal(sc.length,8);assert.equal(sc[0].id,'goals');assert.equal(sc[7].id,'next');});
test('Quran: family days out of people × days so far',()=>{assert.deepEqual([get('quran').on,get('quran').total],[4,12]);assert.equal(get('quran').caption,'Together we read on 4 of 12 days. Nihal read every day.');});
test('showed up unions Quran and dated activity, never future days',()=>{
 assert.deepEqual(report.people.map(p=>showedUp(p,through)),[2,3,1,0]);
 assert.equal(get('showed').caption,'Nihal showed up most: 3 days of 3. Ayah didn’t show up at all.');
 assert.deepEqual(get('showed').bars.map((b:any)=>[b.label,b.v,!!b.hot]),[['Nihal',3,false],['Taylan',2,false],['Ansar',1,false],['Ayah',0,true]]);
});
test('unknown values are left out, never zero',()=>{
 assert.deepEqual(didLines(report.people[0]),['1 Quran day (1 session, 10 min)','1 product validated','0 products launched']);
 assert.equal(get('person-taylan').stats[2].v,null);
});
test('every caption carries text; empty person has a fallback',()=>{for(const s of sc)assert.ok(s.caption.length>10,s.id);assert.match(get('person-ayah').caption,/^Ayah: 0 Quran days \(0 sessions, 0 min\), 0 new ayahs\.$/);});
test('stats email: kdgm tokens only, watch status, dashes for unknown',()=>{
 const {html,subject}=statsEmail(report,[{member:'nihal',opened_at:'2026-10-18T07:10:00Z',finished_at:'2026-10-18T07:12:00Z'}],['nihal','ansar'],'https://x/story');
 assert.equal(subject,'Family week 12 Oct–18 Oct: 1/4 watched');
 const hex=new Set(html.match(/#[0-9A-Fa-f]{6}\b/g));
 for(const h of hex)assert.ok(['#14171C','#1B1F26','#2C333F','#E8ECF3','#93A0B4','#7E8FAA','#6D5AE0','#8B7BE8','#4BB77E','#D96A6A','#ffffff'].includes(h),h);
 assert.match(html,/Watched · Sun/);assert.match(html,/Not yet/);assert.match(html,/No link sent/);
 assert.match(html,/Unavailable this run: custm Meta ads/);assert.doesNotMatch(html,/<style|class=/);
});
test('reminder email escapes the link and names the person',()=>{const {html,subject}=reminderEmail('Nihal',report,'https://x/story?who=nihal&k=1');assert.match(subject,/^Nihal,/);assert.match(html,/who=nihal&amp;k=1/);});
const lastWeek:WeeklyReport={...report,week:weekFor('2026-10-07'),through:'2026-10-11',people:[
 {...person('taylan',[],[m('validated',3),m('launched',0),m('ad_leads',null),m('ad_spend',null)]),quran:quranWeek(['2026-10-05','2026-10-06','2026-10-10'].map(date=>({date,finished:true})),weekFor('2026-10-07').days,'2026-10-11')},
 {...person('nihal',[],[m('discoveries',5),m('mentorship',1),m('os_opens',4)]),quran:quranWeek(['2026-10-05'].map(date=>({date,finished:true})),weekFor('2026-10-07').days,'2026-10-11')},
 person('ansar',[],[m('school_score',80),m('school_work',3)]),person('ayah',[],[]),
]};
test('mid-week: last week cut to the same days; person totals not compared yet',()=>{
 const s=buildStory(report,lastWeek),q=s.find(x=>x.id==='quran')!;
 // Mon–Wed last week: Taylan 2 days (Sat excluded), Nihal 1 → 3. This week 4.
 assert.equal(q.caption,'Together we read on 4 of 12 days (up 1 on last week). Nihal read every day.');
 assert.match(s.find(x=>x.id==='showed')!.caption,/Family total: 6 days \(up 3 on last week\)\.$/);
 assert.equal((s.find(x=>x.id==='person-nihal') as any).stats[0].prev,undefined);
});
test('complete week: each person compared, biggest change named',()=>{
 const full={...report,week:weekFor('2026-10-18'),through:'2026-10-18'};
 const s=buildStory(full,lastWeek),n=s.find(x=>x.id==='person-nihal') as any;
 assert.deepEqual(n.stats.map((x:any)=>x.prev),[5,1,4]);
 assert.match(n.caption,/Biggest change: products found down from 5 to 2\.$/);
 assert.match((s.find(x=>x.id==='person-ansar') as any).caption,/Same as last week\.$/);
});
test('no last week: captions unchanged',()=>assert.equal(buildStory(report,null).find(x=>x.id==='quran')!.caption,'Together we read on 4 of 12 days. Nihal read every day.'));
