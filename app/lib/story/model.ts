// Weekly family story: the Sunday report in, 8 scenes out. Pure (no React, no fetch) so it is unit-tested.
// The weekly email reads `showedUp` and `didLines` from here too, so the film and the email never disagree.
import type {WeeklyReport,PersonReport,MemberId,Metric} from '../sunday/model.ts';
import {SNAPSHOT} from '../goals.ts';

export type Stat={label:string;v:number|null;unit?:'AUD'|'%'};
export type Card={id:string;label:string;v:number;note:string|null;good:boolean};
type Base={label:string;hold:number;caption:string};
export type Scene=
 |Base&{id:'goals';goals:{short:string;label:string;pct:number|null}[]}
 |Base&{id:'quran';on:number;total:number}
 |Base&{id:'showed';bars:{label:string;sub?:string;v:number;hot?:boolean}[];of:number}
 |Base&{id:`person-${MemberId}`;name:string;stats:Stat[]}
 |Base&{id:'next';cards:Card[]};

const s=(n:number,one:string,many=one+'s')=>`${n} ${n===1?one:many}`;
const val=(p:PersonReport,key:Metric['key'])=>p.metrics.find(m=>m.key===key)?.value??null;
export const money=(n:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(n);

/** Days so far this week (Monday through `through`). */
export function daysSoFar(r:WeeklyReport){return r.week.days.filter(d=>d<=r.through).length;}

/** "Showed up" = a day with any dated activity we can see: a finished Quran session, a Nihal OS open,
 *  a product surfaced, a mentorship lesson, a validation, or Ansar homeschool work. Undated manual totals don't count. */
export function showedUp(p:PersonReport,through:string){
 const days=new Set(p.quran.days.filter(d=>d.sessions>0&&d.date<=through).map(d=>d.date));
 for(const m of p.metrics){
  for(const d of m.daily??[])if((d.count??0)>0&&d.date<=through)days.add(d.date);
  for(const [d,n] of Object.entries(m.perDay??{}))if(n>0&&d<=through)days.add(d);
 }
 return days.size;
}

/** One plain line per thing the person did, for captions and the email. Unknown values are left out, never shown as zero. */
export function didLines(p:PersonReport):string[]{
 const out:string[]=[],n=(k:Metric['key'])=>val(p,k);
 if(p.quran.available)out.push(`${s(p.quran.totalDays,'Quran day')} (${s(p.quran.sessions,'session')}, ${p.quran.minutes} min)`);
 if(p.id==='taylan'){
  if(n('validated')!==null)out.push(`${s(n('validated')!,'product')} validated`);
  if(n('launched')!==null)out.push(`${s(n('launched')!,'product')} launched`);
  if(n('ad_leads')!==null)out.push(`${s(n('ad_leads')!,'custm lead')}${n('ad_spend')!==null?` on ${money(n('ad_spend')!)} spend`:''}`);
 }
 if(p.id==='nihal'){
  if(n('discoveries')!==null)out.push(`${s(n('discoveries')!,'product')} found`);
  if(n('mentorship')!==null)out.push(`${s(n('mentorship')!,'mentorship lesson')} watched`);
  if(n('os_opens')!==null)out.push(`opened Nihal OS ${s(n('os_opens')!,'time')}`);
 }
 if(p.id==='ansar'){
  if(n('school_score')!==null)out.push(`${n('school_score')}% Ansar OS score`);
  if(n('school_work')!==null)out.push(`${s(n('school_work')!,'piece')} of homeschool work`);
 }
 if(p.id==='ayah'&&p.quran.available)out.push(`${s(p.quran.days.reduce((t,d)=>t+d.newAyahs,0),'new ayah')}`);
 return out;
}

function personScene(p:PersonReport):Scene{
 const n=(k:Metric['key'])=>val(p,k),q=p.quran.available?p.quran.totalDays:null;
 const stats:Stat[]=p.id==='taylan'?[{label:'Validated',v:n('validated')},{label:'Launched',v:n('launched')},{label:'custm leads',v:n('ad_leads')},{label:'Ad spend',v:n('ad_spend'),unit:'AUD'}]
  :p.id==='nihal'?[{label:'Products found',v:n('discoveries')},{label:'Lessons watched',v:n('mentorship')},{label:'OS opens',v:n('os_opens')}]
  :p.id==='ansar'?[{label:'Ansar OS score',v:n('school_score'),unit:'%'},{label:'Homeschool work',v:n('school_work')},{label:'Quran days',v:q}]
  :[{label:'Quran days',v:q},{label:'New ayahs',v:p.quran.available?p.quran.newAyahs:null},{label:'Minutes',v:p.quran.available?p.quran.minutes:null}];
 const lines=didLines(p).filter(l=>!l.includes('Quran day')||p.id==='ayah'||p.id==='ansar');
 return {id:`person-${p.id}`,label:p.name,hold:6,name:p.name,stats,
  caption:lines.length?`${p.name}: ${lines.slice(0,3).join(', ')}.`:`Nothing from ${p.name} reached the dashboard this week.`};
}

export function buildStory(r:WeeklyReport):Scene[]{
 const days=daysSoFar(r),people=r.people;
 const goals=SNAPSHOT.goals.map(g=>({short:g.short,label:g.label,pct:g.now==null?null:Math.min(100,Math.round(g.now/g.target*100))}));
 const tracked=goals.some(g=>g.pct!==null);
 const quranPeople=people.filter(p=>p.quran.available);
 const on=quranPeople.reduce((t,p)=>t+p.quran.totalDays,0),total=quranPeople.length*days;
 const everyDay=quranPeople.filter(p=>days>0&&p.quran.totalDays===days).map(p=>p.name);
 const shows=people.map(p=>({p,v:showedUp(p,r.through)})).sort((a,b)=>b.v-a.v);
 const low=shows.filter(x=>x.v<days);
 const lowest=low.length?low[low.length-1]:null;
 return [
  {id:'goals',label:'Our goals',hold:5,goals,
   caption:`Our goals: ${goals.map(g=>`${g.short} ${g.label}`).join(', then ')}.${tracked?'':' Progress isn’t tracked yet, so this week is about the habits that get us there.'}`},
  {id:'quran',label:'Quran',hold:6,on,total,
   caption:!quranPeople.length?'Quran OS didn’t connect this week, so these days are unknown.':
    on===0?'No finished Quran sessions this week. Next week starts with one each.':
    `Together we read on ${on} of ${total} days.${everyDay.length?` ${everyDay.join(' and ')} read every day.`:` Nobody managed every day yet.`}`},
  {id:'showed',label:'Showed up',hold:6,of:days,bars:shows.map(x=>({label:x.p.name,sub:`of ${days} days`,v:x.v,hot:!!lowest&&x.v===lowest.v})),
   caption:!low.length?`All four of us showed up every day. ${days} out of ${days}.`:
    `${shows[0].p.name} showed up most: ${s(shows[0].v,'day')} of ${days}. ${lowest!.p.name} ${lowest!.v===0?'didn’t show up at all':`only ${s(lowest!.v,'day')}`}.`},
  ...people.map(personScene),
  {id:'next',label:'Next week',hold:7,
   cards:people.map(p=>({id:p.id,label:p.name,v:showedUp(p,r.through),note:p.win||null,good:showedUp(p,r.through)>=days})),
   caption:people.every(p=>p.win)?'One focus each for next week. Read yours out.':'One focus each for next week. Add yours on the weekly review.'},
 ];
}
