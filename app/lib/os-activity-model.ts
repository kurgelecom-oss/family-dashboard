export const VISIT_GAP_MS=30*60*1000;
export function startsNewVisit(last:{day:string;lastSeen:string|Date}|null,day:string,now:Date){
 return !last||last.day!==day||now.getTime()-new Date(last.lastSeen).getTime()>=VISIT_GAP_MS;
}
export function activitySummary(rows:{day:string;count:number}[],weekDays:string[],today:string,trackingSince:string|null){
 const days=weekDays.map(date=>({date,count:!trackingSince||date<trackingSince||date>today?null:Number(rows.find(r=>r.day===date)?.count??0)}));
 const tracked=days.filter(d=>d.count!==null);
 return {today,trackingSince,days,opensToday:days.find(d=>d.date===today)?.count??null,total:tracked.length?tracked.reduce((n,d)=>n+d.count!,0):null,activeDays:tracked.filter(d=>d.count!>0).length};
}
