import type {NotionPage} from '../notion';
import {dateOf,validDay,type ProductSurfaceEntry} from './model.ts';

// TK confirmed this database is Nihal’s product surface log. Its schema has no
// finder/owner property; attribution comes from this source, never Creative OS.
export const PRODUCT_SURFACE_SOURCE='1d35429a-fa90-81a0-bf47-000b7fe8803d';
export const PRODUCT_SURFACE_URL='https://app.notion.com/p/f27260c1c1884727ae9bbdc0518e18cf?v=3d15429afa90806698e6000c255ef14f';

export function surfaceLogWeek(rows:NotionPage[]|null,week:{start:string;days:string[]},through:string){
 if(rows===null)return null;
 const entries:ProductSurfaceEntry[]=[];
 const seen=new Set<string>();
 for(const row of rows){
  if(!row.id||seen.has(row.id))continue;
  const title=row.properties?.['Product Name'] as {title?:{plain_text:string}[]}|undefined;
  const name=title?.title?.map(t=>t.plain_text).join('').trim();
  if(!name)continue;
  const submitted=(row.properties?.['Submission Date'] as {date?:{start?:string}|null}|undefined)?.date?.start;
  const created=(row.properties?.['Created time'] as {created_time?:string}|undefined)?.created_time??row.created_time;
  // Imported records retain their original submission dates. Editing or
  // validating a product must never make it a new discovery for this week.
  const loggedAt=submitted??created;
  const date=dateOf(loggedAt);
  if(!date||date<week.start||!week.days.includes(date)||date>through)continue;
  seen.add(row.id);
  entries.push({id:row.id,name,date,timestamp:loggedAt&&!validDay(loggedAt)?loggedAt:null,dateSource:submitted?'Submission Date':'Created time',href:`https://app.notion.com/p/${row.id.replaceAll('-','')}`});
 }
 entries.sort((a,b)=>a.date.localeCompare(b.date)||(a.timestamp??'').localeCompare(b.timestamp??'')||a.name.localeCompare(b.name));
 return {total:entries.length,entries,daily:week.days.map(date=>({date,count:date>through?null:entries.filter(e=>e.date===date).length}))};
}
