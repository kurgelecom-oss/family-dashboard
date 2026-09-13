export const MEMBERS = ['taylan', 'nihal', 'ansar', 'ayah'] as const;
export type MemberId = typeof MEMBERS[number];
export type Mode = 'daily' | 'weekly';
export type Theme = 'gather' | 'scorecard' | 'mosaic';
export const TZ = 'Australia/Melbourne';
export function civilDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', {timeZone: TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(t=>parts.find(p=>p.type===t)!.value).join('-');
}
export function validDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10) === s;
}
export function shiftDay(s: string, n: number) { const d = new Date(s+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
export function weekday(s: string) { return new Date(s+'T12:00:00Z').getUTCDay(); }
export function weekFor(today: string) {
  const start = shiftDay(today, -(weekday(today)+6)%7);
  return { start, end: shiftDay(start,6), days: Array.from({length:7},(_,i)=>shiftDay(start,i)) };
}
export function viewFor(today: string, override?: { day: string; mode: Mode } | null): Mode {
  return override?.day===today && ['daily','weekly'].includes(override.mode) ? override.mode : weekday(today)===0 ? 'weekly' : 'daily';
}
export function dateOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (validDay(value)) return value;
  const d = new Date(value); return Number.isNaN(d.getTime()) ? null : civilDay(d);
}
export function inWeek(date: unknown, start: string, through: string) { const d=dateOf(date); return d!==null && d>=start && d<=through; }
export type MetricKey = 'sleep'|'discoveries'|'mentorship'|'validated'|'launched'|'ad_leads'|'ad_spend'|'school_score'|'school_work'|'win';
export const MANUAL_RULES: Record<MetricKey,{members: readonly MemberId[];max:number;label:string;decimal?:boolean;noteOnly?:boolean}> = {
  sleep:{members:['taylan','nihal','ansar'],max:7,label:'Mornings back to sleep'},
  discoveries:{members:['nihal'],max:1000,label:'Products found'},
  mentorship:{members:['nihal'],max:1000,label:'Mentorship sessions watched'},
  validated:{members:['taylan'],max:1000,label:'Products validated'},
  launched:{members:['taylan'],max:1000,label:'Products launched'},
  ad_leads:{members:['taylan'],max:100000,label:'custm ad leads'},
  ad_spend:{members:['taylan'],max:1000000,label:'custm ad spend (AUD)',decimal:true},
  school_score:{members:['ansar'],max:100,label:'Overall homeschool score (%)'},
  school_work:{members:['ansar'],max:1000,label:'Homeschool work records'},
  win:{members:MEMBERS,max:0,label:'One win / next focus',noteOnly:true},
};
export type ManualMode = 'supplement'|'fallback';
export interface ManualEntry {mode:ManualMode;member:MemberId;metric:MetricKey;value:number|null;note:string;version:number;updated_at?:string}
export function parseManual(body: unknown, today = civilDay()) {
  if (!body || typeof body!=='object') throw new Error('Entry required');
  const b=body as Record<string,unknown>; const rule=MANUAL_RULES[b.metric as MetricKey];
  if (!rule || !rule.members.includes(b.member as MemberId)) throw new Error('Choose a supported person and metric');
  if (!validDay(b.weekStart) || weekday(b.weekStart)!==1 || b.weekStart>weekFor(today).start) throw new Error('Choose an existing Monday-starting week');
  if (b.mode==='supplement' && !['discoveries','mentorship','validated','launched'].includes(String(b.metric))) throw new Error('This metric needs a weekly total');
  if (!['supplement','fallback'].includes(String(b.mode))) throw new Error('Choose how this count is used');
  if (typeof b.note!=='string' || b.note.length>600) throw new Error('Keep notes under 600 characters');
  if (!Number.isInteger(b.version) || Number(b.version)<0) throw new Error('Reload this entry before saving');
  if (!rule.noteOnly && (typeof b.value!=='number' || !Number.isFinite(b.value) || b.value<0 || b.value>rule.max || (!rule.decimal && !Number.isInteger(b.value)))) throw new Error(`Enter a number from 0 to ${rule.max}`);
  return {mode:b.mode as ManualMode,weekStart:b.weekStart,member:b.member as MemberId,metric:b.metric as MetricKey,value:rule.noteOnly?null:b.value as number,note:b.note.trim(),version:b.version as number};
}
export type SourceState = 'connected'|'unavailable'|'partial';
export interface Metric {manualMode:ManualMode;backupIgnored:boolean;key:MetricKey;label:string;value:number|null;unit?:string;detail:string;source:'auto'|'manual'|'mixed'|'missing';href?:string;canEdit:boolean;manualValue:number|null}
export interface QuranDay { date:string;sessions:number;minutes:number;newAyahs:number;pages:number;future:boolean }
export interface PersonReport {id:MemberId;name:string;quran:{available:boolean;days:QuranDay[];totalDays:number;sessions:number;minutes:number;newAyahs:number;pages:number};metrics:Metric[];win:string}
export interface WeeklyReport {week:{start:string;end:string;days:string[]};today:string;through:string;generatedAt:string;preview:boolean;people:PersonReport[];manual:ManualEntry[];sources:{id:string;label:string;state:SourceState;detail:string;href:string}[];shared:{discoveries:number|null;validations:number|null;launched:number|null};}
export interface QuranSession {date:string;finished:boolean;minutes?:number;newAyahs?:number;pagesRead?:number}
export function quranWeek(sessions:QuranSession[], days:string[], today:string, available=true):PersonReport['quran'] {
  const rows=days.map(date=>{const ss=sessions.filter(s=>s.finished && s.date===date && date<=today);return {date,future:date>today,sessions:ss.length,minutes:ss.reduce((n,s)=>n+(s.minutes||0),0),newAyahs:ss.reduce((n,s)=>n+(s.newAyahs||0),0),pages:ss.reduce((n,s)=>n+(s.pagesRead||0),0)};});
  return {available,days:rows,totalDays:rows.filter(d=>d.sessions>0).length,sessions:rows.reduce((n,d)=>n+d.sessions,0),minutes:rows.reduce((n,d)=>n+d.minutes,0),newAyahs:rows.reduce((n,d)=>n+d.newAyahs,0),pages:rows.reduce((n,d)=>n+d.pages,0)};
}

/** Backup totals do not become additional activity when a connection recovers. */
export function mergeCount(auto:number|null,entry?:Pick<ManualEntry,'value'|'mode'>){
 const manual=entry?.value??null;
 const usesManual=manual!==null&&(auto===null?entry?.mode==='fallback':entry?.mode==='supplement');
 return {value:auto===null?(usesManual?manual:null):auto+(usesManual?manual!:0),source:(auto===null?(usesManual?'manual':'missing'):(usesManual?'mixed':'auto')) as Metric['source'],backupIgnored:auto!==null&&manual!==null&&entry?.mode==='fallback'};
}
