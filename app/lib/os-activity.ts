import {familyDb,familyWorkspace} from './family-db';
import {civilDay,weekFor} from './sunday/model';
import {startsNewVisit,activitySummary} from './os-activity-model';

export async function readOsActivity(day=civilDay()){
 const db=familyDb(),workspace=familyWorkspace(),today=civilDay(),week=weekFor(day);
 const [rows,tracking]=await Promise.all([
  db`select day::text,count(*)::int as count from fds_os_sessions where workspace=${workspace} and member='nihal' and day>=${week.start}::date and day<=${week.end}::date and day<=${today}::date group by day`,
  db`select started_on::text from fds_os_tracking where workspace=${workspace} and member='nihal'`,
 ]);
 return activitySummary(rows.map(r=>({day:r.day,count:r.count})),week.days,today,tracking[0]?.started_on??null);
}
export async function recordOsActivity(browserId:string){
 if(!/^[a-f0-9]{64}$/.test(browserId))throw new Error('Invalid browser identifier');
 const db=familyDb(),workspace=familyWorkspace();
 await db.begin(async tx=>{
  // Serialise simultaneous refreshes/tabs for the same browser, across server instances.
  await tx`select pg_advisory_xact_lock(hashtextextended(${workspace+':nihal:'+browserId},0))`;
  const now=new Date(),day=civilDay(now);
  const rows=await tx`select id,day::text,last_seen from fds_os_sessions where workspace=${workspace} and member='nihal' and browser_id=${browserId} order by last_seen desc limit 1`;
  const last=rows[0];
  if(startsNewVisit(last?{day:last.day,lastSeen:last.last_seen}:null,day,now)){
   await tx`insert into fds_os_sessions(workspace,member,browser_id,day,opened_at,last_seen) values(${workspace},'nihal',${browserId},${day}::date,${now},${now})`;
  }else await tx`update fds_os_sessions set last_seen=${now} where id=${last.id}`;
 });
 return readOsActivity();
}
