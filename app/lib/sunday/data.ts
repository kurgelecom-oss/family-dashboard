import { familyDb, familyWorkspace } from '../family-db';
import { supabase } from '../supabase';
import { fetchSource, type NotionPage } from '../notion';
import { scoreDay, WEEKLY_MAX } from '../scoring';
import { habitsOnDay } from '../habit-days';
import { MEMBERS, civilDay, dateOf, inWeek, weekFor, quranWeek, mergeCount, type WeeklyReport, type MemberId, type Metric, type MetricKey, type ManualEntry, type QuranSession } from './model';
const FAMILY='https://kurgel-dashboard.netlify.app';
const QURAN='https://quran-os.netlify.app';
const CREATIVE='https://creative-os-318.netlify.app';
const ENGINE='https://product-test-engine.netlify.app';
const NIHAL='https://nihal-os-control-room.netlify.app/#homeschool';
// Read-only, bounded upstream requests. Source failure remains unknown, never zero.
async function json<T>(url:string,headers?:HeadersInit):Promise<T> {
 const r=await fetch(url,{cache:'no-store',headers,signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error('Source unavailable'); return r.json();
}
type Prop={date?:{start?:string}|null;select?:{name?:string}|null;title?:{plain_text:string}[];rich_text?:{plain_text:string}[];number?:number;checkbox?:boolean;people?:{name?:string}[]};
function prop(row:NotionPage,k:string):Prop {return (row.properties?.[k]??{}) as Prop;}
function label(row:NotionPage,k:string){const p=prop(row,k);return p.select?.name??(p.title??p.rich_text??[]).map(x=>x.plain_text).join('');}
function owner(row:NotionPage,k:string){const p=prop(row,k);return (p.select?.name??p.people?.map(x=>x.name).join(' ')??label(row,k)).toLowerCase();}
const originsOwners:Record<number,string>={1:'taylan',2:'taylan',3:'nihal',4:'nihal',5:'taylan',6:'nihal',7:'both',8:'both',9:'taylan',10:'taylan',11:'taylan',12:'nihal'};
type Test={id:string;name:string;launch_date:string|null;status:string};
type Verdict={test_id:string;to_status:string;created_at:string;verdict_date:string};
async function ads(start:string,through:string) {
 const token=process.env.FAMILY_META_TOKEN;
 if(!token)throw new Error('Ads feed unavailable');
 const u=new URL('https://graph.facebook.com/v24.0/act_987478577572922/insights');
 u.searchParams.set('fields','spend,actions,date_start,date_stop');u.searchParams.set('level','account');u.searchParams.set('time_range',JSON.stringify({since:start,until:through}));
 const result=await json<{data:{spend?:string;actions?:{action_type:string;value:string}[]}[]}>(u.href,{Authorization:`Bearer ${token}`});
 if(!Array.isArray(result.data)||!result.data.length)throw new Error('No delivered insight rows');
 // Aggregate "lead" once, never add its overlapping Meta subtypes.
 return {spend:result.data.reduce((s,r)=>s+Number(r.spend||0),0),leads:result.data.reduce((s,r)=>s+Number(r.actions?.find(a=>a.action_type==='lead')?.value||0),0)};
}
async function completions(start:string,through:string) {
 const out:{habit_id:string;completed_date:string}[]=[];
 for(let offset=0;offset<10000;offset+=1000){
  const {data,error}=await supabase.from('habit_completions').select('habit_id,completed_date').gte('completed_date',start).lte('completed_date',through).order('id').range(offset,offset+999);
  if(error)throw new Error('Habits unavailable');out.push(...data);if(data.length<1000)return out;
 }throw new Error('Habit response incomplete');
}
export async function buildWeeklyReport(day=civilDay()):Promise<WeeklyReport> {
 const today=civilDay(),week=weekFor(day),through=week.end<today?week.end:today,db=familyDb();
 const jobs=await Promise.allSettled([
  json<{members:{id:string;sessions:QuranSession[]}[]}>(`${QURAN}/api/snapshot?days=30`,{'x-qos-token':process.env.QURAN_OS_TOKEN||''}),
  fetchSource('1d35429a-fa90-81a0-bf47-000b7fe8803d','Product validation'),
  fetchSource('3a3a6e65-2cb3-40ba-810a-b19406e8b085','Origins'),
  fetchSource('3f93b40d-6cdc-44dc-9197-779758f9150c','Homeschool work log'),
  json<Test[]>(`${ENGINE}/api/tests`),json<Verdict[]>(`${ENGINE}/api/verdicts`),
  db`select id,name,source,raw from cos_radar_products where lower(raw->'intake'->>'found_by')='nihal'`,
  ads(week.start,through),completions(week.start,through),
  json<{id:string;block:string;days:string[]}[]>(`${FAMILY}/api/habits`),
  db`select member,metric,value,note,version,updated_at,mode from fds_weekly_manual where workspace=${familyWorkspace()} and week_start=${week.start}`,
 ] as const);
 const [q,products,origins,school,tests,verdicts,radar,ad,habits,roster,manualResult]=jobs;
 const sources:WeeklyReport['sources']=[];
 const addSource=(id:string,label:string,ok:boolean,detail:string,href:string,partial=false)=>sources.push({id,label,state:ok?(partial?'partial':'connected'):'unavailable',detail:ok?detail:'Connection unavailable. Refresh to retry; manual entries remain available.',href});
 const manual:ManualEntry[]=manualResult.status==='fulfilled'?manualResult.value.map(r=>({mode:r.mode as ManualEntry['mode'],member:r.member as MemberId,metric:r.metric as MetricKey,value:r.value===null?null:Number(r.value),note:r.note,version:r.version,updated_at:new Date(r.updated_at).toISOString()})):[];
 addSource('manual','Family check-ins',manualResult.status==='fulfilled','Saved separately for this week.',FAMILY);
 const productRows=products.status==='fulfilled'?products.value:[];
 const discovered=products.status==='fulfilled'?productRows.filter(r=>inWeek(prop(r,'Submission Date').date?.start,week.start,through)).length:null;
 const validated=products.status==='fulfilled'?productRows.filter(r=>inWeek(prop(r,'Validated On').date?.start,week.start,through)).length:null;
 const productNihal=productRows.filter(r=>['Found by','Submitted by','Owner'].some(k=>owner(r,k)==='nihal')&&inWeek(prop(r,'Submission Date').date?.start,week.start,through));
 const radarNihal=radar.status==='fulfilled'?radar.value.filter(r=>inWeek((r.raw as {intake?:{at?:string}})?.intake?.at,week.start,through)):[];
 const discoveryNames=new Set([...productNihal.map(r=>label(r,'Product Name').trim().toLowerCase()),...radarNihal.map(r=>String(r.name).trim().toLowerCase())].filter(Boolean));
 // A healthy feed without an owner is incomplete attribution, not "Nihal found zero".
 const nihalFound=discoveryNames.size>0?discoveryNames.size:null;
 addSource('products','Product logs & validations',products.status==='fulfilled',`${discovered??0} logged; ${validated??0} dated validation reviews. Older logs do not identify the finder.`,`${FAMILY}/business`,true);
 addSource('radar','Creative OS research',radar.status==='fulfilled','Counts dated intake records marked “found by Nihal”; nightly automated discoveries are excluded.',`${CREATIVE}/radar`,true);
 const watched=origins.status==='fulfilled'?origins.value.filter(r=>{
  const who=owner(r,'Completed By')||originsOwners[prop(r,'Module No').number||0];
  return who==='nihal'&&prop(r,'Done').checkbox===true&&label(r,'Type')==='Training'&&inWeek(prop(r,'Completed On').date?.start,week.start,through);
 }).length:null;
 addSource('mentorship','Origins mentorship',origins.status==='fulfilled','Completed training lessons by Nihal (or her assigned modules). Action items and ambiguous shared lessons are excluded.',`${FAMILY}/origins`);
 let launched:number|null=null;
 if(tests.status==='fulfilled'&&verdicts.status==='fulfilled'){
  const allowed=tests.value.filter(t=>!/^(test(?:\.|$)|GHKCU-BACKTEST)|verification artifact/i.test(t.name));
  launched=allowed.filter(t=>{const first=verdicts.value.filter(v=>v.test_id===t.id&&v.to_status==='Live').map(v=>dateOf(v.created_at)).filter((d):d is string=>!!d).sort()[0]??(t.status==='Live'?dateOf(t.launch_date):null);return inWeek(first,week.start,through);}).length;
 }
 addSource('tests','Launchpad & product tests',launched!==null,'Counts the first recorded launch per product; relaunches and verification tests are excluded. Browser-only candidates need a manual entry.', 'https://ecom-launchpad-mentor.netlify.app',true);
 const work=school.status==='fulfilled'?school.value.filter(r=>label(r,'Student')==='Ansar'&&label(r,'Log type')==='Work submission'&&label(r,'Flag')!=='Test / seed data'&&inWeek(prop(r,'Date of work').date?.start,week.start,through)):null;
 const areas=new Set(work?.map(r=>label(r,'Learning area')).filter(a=>a&&a!=='Not applicable'));
 const workDays=new Set(work?.map(r=>dateOf(prop(r,'Date of work').date?.start)).filter(Boolean));
 addSource('school','Ansar homeschool',school.status==='fulfilled','Dated work submissions, school days and learning areas from the master work log.',NIHAL);
 let schoolScore:number|null=null,points:number|null=null;
 if(habits.status==='fulfilled'&&roster.status==='fulfilled'&&roster.value.length){
  const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday'];let perfect=0;points=0;
  for(let i=0;i<5;i++){
   if(week.days[i]>through)continue;
   const list=habitsOnDay(roster.value,weekdays[i]);const ids=new Set(habits.value.filter(r=>r.completed_date===week.days[i]).map(r=>r.habit_id));
   const s=scoreDay(ids,weekdays[i],list.filter(h=>h.block==='pre').map(h=>h.id),list.filter(h=>h.block!=='conditional').map(h=>h.id));points+=s.total;if(s.perfect)perfect++;
  }if(perfect===5)points+=3;schoolScore=Math.round(points/WEEKLY_MAX*100);
 }
 addSource('habits','Ansar OS score',schoolScore!==null,'Canonical weekday score out of 55, including the perfect-week bonus. Weekend stretch points are excluded.', 'https://ansar-habits-tracker.netlify.app');
 addSource('quran','Quran OS',q.status==='fulfilled','Finished sessions only; daily attendance is counted once per person. Refreshes every minute.',QURAN);
 addSource('ads','custm Meta ads',ad.status==='fulfilled','Account leads and spend for these exact dates. Leads are enquiries, not confirmed customers; today is still updating.',`${CREATIVE}/mission-control`);
 function metric(member:MemberId,key:MetricKey,labelText:string,auto:number|null,detail:string,href?:string,unit?:string):Metric {
  const m=manual.find(r=>r.member===member&&r.metric===key);const manualValue=m?.value??null;
  const editable=auto===null||['discoveries','mentorship','validated','launched'].includes(key);
  const canSupplement=['discoveries','mentorship','validated','launched'].includes(key);
  const mode=m?.mode ?? (canSupplement && (auto!==null || (key==='discoveries' && radar.status==='fulfilled' && products.status==='fulfilled'))?'supplement':'fallback');
  return {key,label:labelText,...mergeCount(key==='discoveries' && auto===null && m?.mode==='supplement' && radar.status==='fulfilled' && products.status==='fulfilled' ? 0 : auto,m),unit,detail,manualValue,manualMode:mode,canEdit:editable||!!m,href};
 }
 const people=MEMBERS.map(id=>{
  const ss=q.status==='fulfilled'?q.value.members.find(m=>m.id===id)?.sessions:undefined;
  const metrics:Metric[]=[];
  if(id==='taylan')metrics.push(metric(id,'ad_leads','custm ad leads',ad.status==='fulfilled'?ad.value.leads:null,ad.status==='fulfilled'&&ad.value.leads?`$${(ad.value.spend/ad.value.leads).toFixed(2)} per lead`:'Enquiries from Meta ads',`${CREATIVE}/mission-control`),metric(id,'ad_spend','Ad spend',ad.status==='fulfilled'?Math.round(ad.value.spend*100)/100:null,'AUD · selected week',`${CREATIVE}/mission-control`,'AUD'),metric(id,'validated','Products validated',validated,'Shared pipeline · dated reviews, including passes and kills',`${FAMILY}/business`),metric(id,'launched','Products launched',launched,'Shared pipeline · first launch in the test log','https://ecom-launchpad-mentor.netlify.app'));
  if(id==='nihal')metrics.push(metric(id,'discoveries','Products found',nihalFound,nihalFound===null?'Add finds missing your name in the source log':'Attributed research records',`${CREATIVE}/radar`),metric(id,'mentorship','Mentorship watched',watched,'Completed Origins training sessions',`${FAMILY}/origins`));
  if(id==='ansar')metrics.push(metric(id,'school_score','Overall week score',schoolScore,points===null?'Add the weekly score if the tracker is unavailable':`${points} / ${WEEKLY_MAX} Ansar OS points · week to date`,'https://ansar-habits-tracker.netlify.app','%'),metric(id,'school_work','Homeschool work',work===null?null:work.length,work===null?'Add this week’s work count':`${workDays.size} days · ${areas.size} learning areas`,NIHAL));
  if(id!=='ayah')metrics.push(metric(id,'sleep','Back to sleep',null,'Mornings after first waking · enter 0 for none'));
  return {id,name:id[0].toUpperCase()+id.slice(1),quran:quranWeek(ss??[],week.days,through,ss!==undefined),metrics,win:manual.find(r=>r.member===id&&r.metric==='win')?.note??''};
 });
 return {week,today,through,generatedAt:new Date().toISOString(),preview:familyWorkspace()!=='production',people,manual,sources,shared:{discoveries:discovered,validations:validated,launched}};
}
