import {createHmac,timingSafeEqual} from 'node:crypto';
import {familyDb,familyWorkspace} from '../family-db';
import {MEMBERS,type MemberId} from '../sunday/model';

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
export async function gmail(to:string,subject:string,html:string){
 const key=process.env.FAMILY_COMPOSIO_API_KEY,account=process.env.FAMILY_GMAIL_ACCOUNT_ID;
 if(!key||!account)throw new Error('Email is not configured: set FAMILY_COMPOSIO_API_KEY and FAMILY_GMAIL_ACCOUNT_ID');
 const r=await fetch('https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL',{method:'POST',signal:AbortSignal.timeout(20000),
  headers:{'x-api-key':key,'Content-Type':'application/json'},
  body:JSON.stringify({connected_account_id:account,entity_id:process.env.FAMILY_GMAIL_ENTITY_ID||'default',version:'latest',arguments:{recipient_email:to,subject,body:html,is_html:true,user_id:'me'}})});
 const b=await r.json().catch(()=>null);
 if(!r.ok||b?.successful!==true)throw new Error(`Gmail send failed (${r.status})`);
}
