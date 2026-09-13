import {NextResponse} from 'next/server';
import {isFamilyService} from '../../lib/family-auth';
import {readOsActivity,recordOsActivity} from '../../lib/os-activity';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function GET(){
 try{return NextResponse.json(await readOsActivity(),{headers});}
 catch{return NextResponse.json({error:'OS visit counts are temporarily unavailable.'},{status:503,headers});}
}
export async function POST(request:Request){
 if(!isFamilyService(request))return NextResponse.json({error:'Use Nihal OS to record visits.'},{status:401,headers});
 let b;try{b=await request.json();}catch{return NextResponse.json({error:'Invalid request'},{status:400,headers});}
 if(typeof b?.browserId!=='string'||!/^[a-f0-9]{64}$/.test(b.browserId))return NextResponse.json({error:'Invalid browser identifier'},{status:400,headers});
 try{return NextResponse.json(await recordOsActivity(b.browserId),{headers});}
 catch{return NextResponse.json({error:'This visit could not be saved. Retrying shortly.'},{status:503,headers});}
}
