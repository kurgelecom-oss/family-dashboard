import { NextResponse } from "next/server";
import {canEditFamily} from "../../lib/family-auth";
import { familyDb, familyWorkspace } from "../../lib/family-db";
import { cyclePayload, parseCycleChange, type CycleRecord } from "../../lib/cycle-state";
import { civilDay } from "../../lib/sunday/model";
import { parseCivilDate, daysBetween } from "../../lib/time";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const SANE_GAP_MIN=15, SANE_GAP_MAX=60;
const NOTION_CYCLE_SOURCE = "ae2a2c28-b967-4ce4-bde2-59ca193ed874";
const NOTION_TIMEOUT_MS = 4000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function notionHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": "2025-09-03",
    "Content-Type": "application/json",
  };
}

/** Create the new start's row, and stamp the finished cycle's length onto the
    previous row (found by its exact start date). */
async function mirrorToNotion(todayIso: string, prevIso: string | null): Promise<void> {
  const token = process.env.NOTION_TOKEN;
  if (!token) return;

  try {
    const month = MONTHS[Number(todayIso.slice(5, 7)) - 1] ?? "";
    await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders(token),
      signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: NOTION_CYCLE_SOURCE },
        properties: {
          "Name": { title: [{ text: { content: `${month} ${todayIso.slice(0, 4)}` } }] },
          "Start date": { date: { start: todayIso } },
          "Source": { select: { name: "Red button" } },
          "Within normal range": { select: { name: "Pending next press" } },
        },
      }),
    });
  } catch {
    // Mirror only; the press already succeeded in Supabase.
  }

  if (prevIso === null) return;
  try {
    const prev = parseCivilDate(prevIso);
    const today = parseCivilDate(todayIso);
    if (prev === null || today === null) return;
    const gap = daysBetween(prev, today);
    const verdict =
      gap >= 21 && gap <= 35 ? "Yes"
      : gap >= SANE_GAP_MIN && gap <= SANE_GAP_MAX ? "Watch"
      : "Excluded blip";

    const query = await fetch(`https://api.notion.com/v1/data_sources/${NOTION_CYCLE_SOURCE}/query`, {
      method: "POST",
      headers: notionHeaders(token),
      signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
      body: JSON.stringify({
        page_size: 1,
        filter: { property: "Start date", date: { equals: prevIso } },
      }),
    });
    if (!query.ok) return;
    const rows = (await query.json()) as { results?: { id?: string }[] };
    const pageId = rows.results?.[0]?.id;
    if (!pageId) return;

    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: notionHeaders(token),
      signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
      body: JSON.stringify({
        properties: {
          "Cycle length (days)": { number: gap },
          "Within normal range": { select: { name: verdict } },
        },
      }),
    });
  } catch {
    // Same posture: the length backfills by hand if this ever misses.
  }
}


const headers = { "Cache-Control": "no-store" };
const respond=(body:object,status=200)=>NextResponse.json(body,{status,headers});
async function readState():Promise<CycleRecord> {
 const [r]=await familyDb()`select active,started_on::text,ended_on::text,version from fds_cycle_state where workspace=${familyWorkspace()}`;
 if(!r)throw new Error('Cycle switch has not been initialised');
 return {active:r.active,startedOn:r.started_on,endedOn:r.ended_on,version:r.version};
}
export async function GET(request:Request){
 try {
  const state=cyclePayload(await readState(),civilDay());
  if(new URL(request.url).searchParams.get('history')!=='1')return respond(state);
  const rows=await familyDb()`select started_on::text,ended_on::text from fds_cycle_history where workspace=${familyWorkspace()} order by started_on desc limit 120`;
  const entries=rows.map((r,i)=>{const gap=i===0?null:Math.round((Date.parse(rows[i-1].started_on)-Date.parse(r.started_on))/86400000);return {startedOn:r.started_on,endedOn:r.ended_on,gapDays:gap,sane:gap!==null&&gap>=15&&gap<=60};});
  const gaps=entries.filter(e=>e.sane).map(e=>e.gapDays!);
  // Start-to-start history is retained; it never determines the on/off state.
  return respond({...state,entries,count:entries.length,lastStart:state.startedOn,avgGap:gaps.length?Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length):null,minGap:gaps.length?Math.min(...gaps):null,maxGap:gaps.length?Math.max(...gaps):null,expectedNext:null});
 }catch{return respond({error:'Cycle state unavailable. Please retry.'},503);}
}
export async function POST(request:Request){
 if(!await canEditFamily(request))return respond({error:"Unlock family editing first"},401);
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'Use the dashboard switch'},403);
 let change;try{change=parseCycleChange(await request.json());}catch{return respond({error:'Reload the switch and try again'},400);}
 try {
  const db=familyDb(),workspace=familyWorkspace(),today=civilDay();
  const result=await db.begin(async tx=>{
   const [old]=await tx`select active,started_on::text,ended_on::text,version from fds_cycle_state where workspace=${workspace} for update`;
   if(!old)throw new Error('State missing');
   if(old.version!==change.version)return {conflict:true};
   if(old.active===change.active)return {conflict:false,previous:old.started_on,changed:false};
   await tx`update fds_cycle_state set active=${change.active},started_on=${change.active?today:old.started_on},ended_on=${change.active?null:today},version=version+1,updated_at=now() where workspace=${workspace}`;
   if(change.active)await tx`insert into fds_cycle_history(workspace,started_on) values(${workspace},${today}) on conflict(workspace,started_on) do update set ended_on=null`;
   else await tx`update fds_cycle_history set ended_on=${today} where workspace=${workspace} and started_on=${old.started_on}`;
   return {conflict:false,previous:old.started_on,changed:true};
  });
  if(result.conflict)return respond({...cyclePayload(await readState(),today),error:'Changed on another screen. The latest state is shown.'},409);
  if(result.changed&&change.active&&workspace==='production')await mirrorToNotion(today,result.previous??null);
  return respond(cyclePayload(await readState(),today));
 }catch{return respond({error:'Switch was not saved. Please retry.'},503);}
}
