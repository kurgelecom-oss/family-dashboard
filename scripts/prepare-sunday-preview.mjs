import fs from 'node:fs/promises';
import postgres from 'postgres';
const workspace=process.env.FAMILY_WORKSPACE;
if(!workspace || workspace==='production')throw new Error('Set FAMILY_WORKSPACE to the preview name first');
const db=postgres(process.env.FAMILY_DATABASE_URL,{ssl:'require',prepare:false,max:1});
try {
 await db.unsafe(await fs.readFile(new URL('../db/001-family-review.sql',import.meta.url),'utf8'));
 const [current,history]=await Promise.all(['','?history=1'].map(async suffix=>{const r=await fetch('https://kurgel-dashboard.netlify.app/api/cycle'+suffix);if(!r.ok)throw new Error('Cannot copy current cycle state');return r.json();}));
 await db`insert into fds_cycle_state(workspace,active,started_on,ended_on) values(${workspace},${current.active??current.activeDay!==null},${current.startedOn},${current.endedOn??null}) on conflict(workspace) do nothing`;
 for(const row of history.entries)await db`insert into fds_cycle_history(workspace,started_on,ended_on) values(${workspace},${row.startedOn},${row.endedOn??null}) on conflict do nothing`;
 console.log('Preview storage ready; live records unchanged.');
}finally{await db.end();}
