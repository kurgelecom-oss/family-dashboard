// One-time migration from the live legacy tracker. Never copies preview check-ins.
import fs from 'node:fs/promises';
import postgres from 'postgres';
if(!process.argv.includes('--initialise-production'))throw new Error('Explicit --initialise-production required');
const db=postgres(process.env.FAMILY_DATABASE_URL,{ssl:'require',prepare:false,max:1});
try{
 await db.unsafe(await fs.readFile(new URL('../db/001-family-review.sql',import.meta.url),'utf8'));
 const [state,history]=await Promise.all(['','?history=1'].map(async q=>{const r=await fetch('https://kurgel-dashboard.netlify.app/api/cycle'+q,{cache:'no-store'});if(!r.ok)throw new Error('Live cycle unavailable');return r.json();}));
 if(typeof state.active!=='boolean'&&state.activeDay!==null&&!Number.isInteger(state.activeDay))throw new Error('Unexpected live state');
 if(!Array.isArray(history.entries))throw new Error('Unexpected history');
 await db.begin(async tx=>{
  await tx`insert into fds_cycle_state(workspace,active,started_on,ended_on) values('production',${state.active??state.activeDay!==null},${state.startedOn},${state.endedOn??null}) on conflict(workspace) do nothing`;
  for(const row of history.entries)await tx`insert into fds_cycle_history(workspace,started_on,ended_on) values('production',${row.startedOn},${row.endedOn??null}) on conflict do nothing`;
 });
 const rows=await db`select active,started_on::text,version from fds_cycle_state where workspace='production'`;
 console.log(JSON.stringify({initialised:true,history:history.entries.length,state:rows[0]}));
}finally{await db.end();}
