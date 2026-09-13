import {NextResponse} from 'next/server';
import {canEditFamily} from '../../lib/family-auth';
import {buildWeeklyReport} from '../../lib/sunday/data';
import {civilDay,validDay,weekFor,shiftDay,parseManual} from '../../lib/sunday/model';
import {familyDb,familyWorkspace} from '../../lib/family-db';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET(request:Request){
 const day=new URL(request.url).searchParams.get('week')||civilDay();
 if(!validDay(day)||day>civilDay()||weekFor(day).start<shiftDay(civilDay(),-29))return NextResponse.json({error:'Choose a week within the last 30 days'},{status:400,headers});
 try{return NextResponse.json(await buildWeeklyReport(day),{headers});}catch{return NextResponse.json({error:'The weekly report could not load. Try refresh.'},{status:503,headers});}
}
export async function PUT(request:Request){
 if(!await canEditFamily(request))return NextResponse.json({error:"Unlock family editing first"},{status:401,headers});
 // Same-origin browser writes. All values are constrained and SQL parameters stay bound.
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return NextResponse.json({error:'Use this dashboard to save entries'},{status:403,headers});
 let b;try{b=parseManual(await request.json());}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid entry'},{status:400,headers});}
 try{
  const db=familyDb();const rows=await db`
   insert into fds_weekly_manual (workspace,week_start,member,metric,value,note,mode)
   select ${familyWorkspace()},${b.weekStart}::date,${b.member},${b.metric},${b.value},${b.note},${b.mode} where ${b.version}=0
   on conflict(workspace,week_start,member,metric) do nothing returning version`;
  if(!rows.length){
   const updated=await db`update fds_weekly_manual set value=${b.value},note=${b.note},mode=${b.mode},version=version+1,updated_at=now() where workspace=${familyWorkspace()} and week_start=${b.weekStart} and member=${b.member} and metric=${b.metric} and version=${b.version} returning version`;
   if(!updated.length)return NextResponse.json({error:'This entry changed on another screen. Refresh and try again.'},{status:409,headers});
  }
  return NextResponse.json({saved:true},{headers});
 }catch{return NextResponse.json({error:'Entry was not saved. Please retry.'},{status:503,headers});}
}
