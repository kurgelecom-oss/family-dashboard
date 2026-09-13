import {NextResponse} from 'next/server';
import {canEditFamily,EDIT_COOKIE,editSession,validFamilyPin} from '../../lib/family-auth';
export const dynamic='force-dynamic';
const attempts=new Map<string,{count:number;until:number}>();
const headers={'Cache-Control':'no-store'};
export async function GET(request:Request){return NextResponse.json({unlocked:await canEditFamily(request)},{headers});}
export async function POST(request:Request){
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return NextResponse.json({error:'Open the family dashboard to unlock editing'},{status:403,headers});
 const ip=request.headers.get('x-nf-client-connection-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'local';
 const now=Date.now(),entry=attempts.get(ip);
 if(entry&&entry.until>now&&entry.count>=5)return NextResponse.json({error:'Please wait a few minutes before trying again.'},{status:429,headers});
 const body=await request.json().catch(()=>null);
 if(!validFamilyPin(body?.pin)){attempts.set(ip,{count:entry&&entry.until>now?entry.count+1:1,until:entry&&entry.until>now?entry.until:now+600000});return NextResponse.json({error:'That PIN did not match.'},{status:401,headers});}
 try{const response=NextResponse.json({unlocked:true},{headers});response.cookies.set(EDIT_COOKIE,editSession(),{httpOnly:true,secure:new URL(request.url).protocol==='https:',sameSite:'strict',path:'/',maxAge:365*86400});attempts.delete(ip);return response;}catch{return NextResponse.json({error:'Editing is not configured yet.'},{status:503,headers});}
}
