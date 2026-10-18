import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {runWeeklyEmails} from '../../lib/story/server';
export const dynamic='force-dynamic';
export const maxDuration=26;
const headers={'Cache-Control':'no-store'};
function authorised(request:Request){
 const want=process.env.FAMILY_CRON_SECRET,got=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 return !!want&&want.length===got.length&&timingSafeEqual(Buffer.from(want),Buffer.from(got));
}
// Called hourly on Sunday evenings by netlify/functions/family-weekly-email. ?force=reminder|stats&dry=1 for checks.
export async function POST(request:Request){
 if(!authorised(request))return NextResponse.json({error:'Unauthorised'},{status:401,headers});
 const q=new URL(request.url).searchParams,f=q.get('force');
 try{return NextResponse.json(await runWeeklyEmails({force:f==='reminder'||f==='stats'?f:undefined,dry:q.get('dry')==='1'}),{headers});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Weekly email failed'},{status:503,headers});}
}
