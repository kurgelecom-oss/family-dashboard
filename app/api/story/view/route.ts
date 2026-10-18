import {NextResponse} from 'next/server';
import {recordView,validStoryKey} from '../../../lib/story/server';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
// Only a signed personal link (from the Sunday reminder) can record a watch.
export async function POST(request:Request){
 let b;try{b=await request.json();}catch{return NextResponse.json({error:'Invalid request'},{status:400,headers});}
 if(!validStoryKey(b?.w,b?.who,b?.k))return NextResponse.json({error:'This story link is not valid'},{status:401,headers});
 try{await recordView(b.w,b.who,b.event==='finish');return NextResponse.json({saved:true},{headers});}
 catch{return NextResponse.json({error:'Watch not saved'},{status:503,headers});}
}
