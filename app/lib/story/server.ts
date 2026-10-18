import {createHmac,timingSafeEqual} from 'node:crypto';
import {familyDb,familyWorkspace} from '../family-db';
import {buildWeeklyReport} from '../sunday/data';
import {MEMBERS,civilDay,weekFor,type MemberId} from '../sunday/model';
import {statsEmail,reminderEmail,type View} from './email';

export const SITE=(process.env.FAMILY_SITE_URL||'https://kurgel-dashboard.netlify.app').replace(/\/$/,'');
const isMember=(m:unknown):m is MemberId=>MEMBERS.includes(m as MemberId);

/** Per-person, per-week link signature, so a watch is attributed without a login. */
export function storyKey(week:string,member:MemberId){
 const secret=process.env.FAMILY_SESSION_SECRET;if(!secret)throw new Error('Story links unavailable');
 return createHmac('sha256',secret).update(`story:${week}:${member}`).digest('hex').slice(0,32);
}
export function validStoryKey(week:unknown,member:unknown,key:unknown):member is MemberId{
 if(typeof week!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(week)||!isMember(member)||typeof key!=='string')return false;
 const want=Buffer.from(storyKey(week,member)),got=Buffer.from(key);
 return want.length===got.length&&timingSafeEqual(want,got);
}
export const storyLink=(week:string,member:MemberId)=>`${SITE}/story?who=${member}&w=${week}&k=${storyKey(week,member)}`;

export async function recordView(week:string,member:MemberId,finished:boolean){
 const db=familyDb(),ws=familyWorkspace();
 await db`insert into fds_story_views(workspace,week_start,member,opened_at,finished_at) values(${ws},${week}::date,${member},now(),${finished?new Date():null})
  on conflict(workspace,week_start,member) do update set finished_at=coalesce(fds_story_views.finished_at,excluded.finished_at)`;
}
export async function readViews(week:string):Promise<View[]>{
 const rows=await familyDb()`select member,opened_at,finished_at from fds_story_views where workspace=${familyWorkspace()} and week_start=${week}::date`;
 return rows.map(r=>({member:r.member,opened_at:new Date(r.opened_at).toISOString(),finished_at:r.finished_at?new Date(r.finished_at).toISOString():null}));
}

/** "nihal:a@x.com,ansar:b@y.com" → recipients. Unknown names are ignored. */
export function reminderRecipients(raw=process.env.FAMILY_REMINDER_TO||''){
 return raw.split(',').map(x=>x.trim().split(':')).filter(([m,e])=>isMember(m)&&/^[^\s@]+@[^\s@]+$/.test(e||'')).map(([m,e])=>({member:m as MemberId,email:e}));
}

async function gmail(to:string,subject:string,html:string){
 const key=process.env.FAMILY_COMPOSIO_API_KEY,account=process.env.FAMILY_GMAIL_ACCOUNT_ID;
 if(!key||!account)throw new Error('Email is not configured: set FAMILY_COMPOSIO_API_KEY and FAMILY_GMAIL_ACCOUNT_ID');
 const r=await fetch('https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL',{method:'POST',signal:AbortSignal.timeout(20000),
  headers:{'x-api-key':key,'Content-Type':'application/json'},
  body:JSON.stringify({connected_account_id:account,entity_id:process.env.FAMILY_GMAIL_ENTITY_ID||'default',version:'latest',arguments:{recipient_email:to,subject,body:html,is_html:true,user_id:'me'}})});
 const b=await r.json().catch(()=>null);
 if(!r.ok||b?.successful!==true)throw new Error(`Gmail send failed (${r.status})`);
}

/** At most once per week, kind and recipient: the row is claimed before sending and only released on a failed send. */
async function sendOnce(week:string,kind:'reminder'|'stats',to:string,subject:string,html:string){
 const db=familyDb(),ws=familyWorkspace();
 const claimed=await db`insert into fds_email_sends(workspace,week_start,kind,recipient) values(${ws},${week}::date,${kind},${to}) on conflict do nothing returning recipient`;
 if(!claimed.length)return 'already sent';
 try{await gmail(to,subject,html);return 'sent';}
 catch(e){await db`delete from fds_email_sends where workspace=${ws} and week_start=${week}::date and kind=${kind} and recipient=${to}`;throw e;}
}
async function remindedMembers(week:string){
 const rows=await familyDb()`select recipient from fds_email_sends where workspace=${familyWorkspace()} and week_start=${week}::date and kind='reminder'`;
 const sent=new Set(rows.map(r=>r.recipient));
 return reminderRecipients().filter(x=>sent.has(x.email)).map(x=>x.member);
}

export function melbourneNow(now=new Date()){
 const p=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Melbourne',weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(now);
 return {weekday:p.find(x=>x.type==='weekday')!.value,hour:Number(p.find(x=>x.type==='hour')!.value)};
}

/** Sunday 6 pm: family reminders. Sunday 8 pm: tk's stats. `force` runs one now; `dry` renders without sending. */
export async function runWeeklyEmails({force,dry=false}:{force?:'reminder'|'stats';dry?:boolean}={}){
 const {weekday,hour}=melbourneNow(),week=weekFor(civilDay()).start;
 const due={reminder:force==='reminder'||(!force&&weekday==='Sun'&&hour>=18),stats:force==='stats'||(!force&&weekday==='Sun'&&hour>=20)};
 const out:Record<string,string>={};
 if(!due.reminder&&!due.stats)return {week,out,note:`Not due (Melbourne ${weekday} ${hour}:00)`};
 const report=await buildWeeklyReport();
 if(due.reminder)for(const {member,email} of reminderRecipients()){
  const name=report.people.find(p=>p.id===member)!.name,mail=reminderEmail(name,report,storyLink(week,member));
  if(dry){out[`reminder:${member}`]=mail.html;continue;}
  try{out[`reminder:${member}`]=await sendOnce(week,'reminder',email,mail.subject,mail.html);}catch(e){out[`reminder:${member}`]=e instanceof Error?e.message:'failed';}
 }
 if(due.stats){
  const mail=statsEmail(report,await readViews(week),await remindedMembers(week),`${SITE}/story`);
  const to=process.env.FAMILY_STATS_TO||'kurgelecom@gmail.com';
  if(dry)out.stats=mail.html;
  else try{out.stats=await sendOnce(week,'stats',to,mail.subject,mail.html);}catch(e){out.stats=e instanceof Error?e.message:'failed';}
 }
 return {week,out};
}
