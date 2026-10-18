// Weekly family emails in the kdgm kit (Outlook-safe: tables, inline styles, ten tokens only). Pure, so tested.
import type {WeeklyReport,MemberId} from '../sunday/model.ts';
import {SNAPSHOT} from '../goals.ts';
import {daysSoFar,didLines,showedUp} from './model.ts';

export type View={member:MemberId;opened_at:string;finished_at:string|null};
const C={bg:'#14171C',panel:'#1B1F26',line:'#2C333F',ink:'#E8ECF3',dim:'#93A0B4',quiet:'#7E8FAA',accent:'#6D5AE0',link:'#8B7BE8',pos:'#4BB77E',neg:'#D96A6A'};
const F="'Archivo','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const T='role="presentation" cellspacing="0" cellpadding="0" border="0"';
const esc=(x:string)=>x.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const short=(iso:string)=>new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z'));
const day=(iso:string)=>`${new Intl.DateTimeFormat('en-AU',{weekday:'long',timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z'))} ${short(iso)}`;
const at=(iso:string)=>new Intl.DateTimeFormat('en-AU',{weekday:'short',hour:'numeric',minute:'2-digit',timeZone:'Australia/Melbourne'}).format(new Date(iso));
const txt=(size:number,color:string,extra='')=>`font-family:${F};font-size:${size}px;color:${color};${extra}`;
export const weekLabel=(r:WeeklyReport)=>`${short(r.week.start)}–${short(r.week.end)}`;

function shell(kicker:string,title:string,intro:string,body:string,source:string){
 return `<!doctype html><html><body style="margin:0;padding:0;background:${C.bg}"><table ${T} width="100%" style="background:${C.bg}"><tr><td style="padding:32px 12px 48px 12px" align="center"><table ${T} width="620" style="max-width:620px;width:100%">
<tr><td style="padding:0 8px"><table ${T}><tr><td width="46" height="46" style="width:46px;height:46px;background:${C.accent};border-radius:13px;text-align:center;${txt(25,'#ffffff','font-weight:500;line-height:46px')}">K</td><td style="padding-left:14px;${txt(24,C.ink,'font-weight:500;letter-spacing:-0.02em')}">Kurgel</td><td style="padding-left:14px;${txt(11,C.quiet,'font-weight:500;letter-spacing:0.08em;text-transform:uppercase')}">${esc(kicker)}</td></tr></table></td></tr>
<tr><td style="padding:24px 8px 0 8px;${txt(26,C.ink,'font-weight:500;letter-spacing:-0.02em;line-height:1.25')}">${esc(title)}</td></tr>
<tr><td style="padding:16px 8px 0 8px"><table ${T} width="100%"><tr><td height="2" style="height:2px;background:${C.accent};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:22px 8px 0 8px;${txt(15,C.ink,'line-height:1.6')}">${intro}</td></tr>
${body}
<tr><td style="padding:34px 8px 0 8px"><table ${T} width="100%"><tr><td style="border-top:1px solid ${C.line};padding-top:20px;${txt(15,C.ink,'font-weight:500;letter-spacing:-0.02em')}">Kurgel <a href="https://kdgm.com.au" style="color:${C.link};text-decoration:none;${txt(13,C.link)}">kdgm.com.au</a></td></tr>
<tr><td style="padding-top:12px;${txt(11,C.quiet,'line-height:1.6')}">${source}</td></tr></table></td></tr>
</table></td></tr></table></body></html>`;
}
const card=(heading:string,inner:string)=>`<tr><td style="padding:26px 8px 0 8px"><table ${T} width="100%" style="background:${C.panel};border:1px solid ${C.line};border-radius:12px"><tr><td style="padding:20px 22px"><table ${T} width="100%"><tr><td style="padding-bottom:14px;${txt(16,C.ink,'font-weight:500;letter-spacing:-0.02em')}">${esc(heading)}</td></tr>${inner}</table></td></tr></table></td></tr>`;
const para=(html:string)=>`<tr><td style="padding-bottom:10px;${txt(14,C.dim,'line-height:1.6')}">${html}</td></tr>`;

export function statsEmail(r:WeeklyReport,views:View[],reminded:MemberId[],storyUrl:string){
 const days=daysSoFar(r),seen=(m:MemberId)=>views.find(v=>v.member===m);
 const th=(x:string,align='left')=>`<td align="${align}" style="padding-bottom:8px;${txt(11,C.quiet,'font-weight:500;letter-spacing:0.06em;text-transform:uppercase')}">${x}</td>`;
 const td=(x:string,color=C.ink,align='left')=>`<td align="${align}" style="padding-top:9px;border-top:1px solid ${C.line};${txt(13,color)}">${x}</td>`;
 const rows=r.people.map(p=>{
  const v=seen(p.id),up=showedUp(p,r.through);
  const watch=v?.finished_at?`Watched · ${at(v.finished_at)}`:v?`Opened · ${at(v.opened_at)}`:reminded.includes(p.id)?'Not yet':'No link sent';
  return `<tr>${td(esc(p.name))}${td(`${up} / ${days}`,up>=days?C.pos:up===0?C.neg:C.ink,'right')}${td(p.quran.available?`${p.quran.totalDays} / ${days}`:'—',C.ink,'right')}${td(watch,v?.finished_at?C.pos:v?C.ink:C.quiet,'right')}</tr>`;
 }).join('');
 const table=`<tr><td><table ${T} width="100%"><tr>${th('Person')}${th('Showed up','right')}${th('Quran','right')}${th('Story','right')}</tr>${rows}</table></td></tr>`;
 const people=r.people.map(p=>{
  const lines=didLines(p);
  return card(p.name,(lines.length?lines.map(l=>para(esc(l[0].toUpperCase()+l.slice(1))+'.')).join(''):para('Nothing reached the dashboard this week.'))+(p.win?para(`Their note: ${esc(p.win)}`):''));
 }).join('');
 const goals=card('Goals',SNAPSHOT.goals.map((g,i)=>para(`${i+1}. ${g.full} ${g.label}: ${g.now==null?'— (progress not tracked yet)':`${Math.min(100,Math.round(g.now/g.target*100))}%`}`)).join(''));
 const unavailable=r.sources.filter(s=>s.state==='unavailable').map(s=>s.label);
 const watched=views.filter(v=>v.finished_at).length;
 const intro=`Monday ${short(r.week.start)} to ${day(r.through)}. ${watched} of ${r.people.length} watched the story. <a href="${esc(storyUrl)}" style="color:${C.link};text-decoration:none;${txt(15,C.link)}">Open the story</a>`;
 const html=shell(`Family week · ${weekLabel(r)}`,'Who did what this week',intro,
  card('Who showed up',para(`A day counts when something dated reached the dashboard: a finished Quran session, a Nihal OS open, a product found, a lesson, a validation or homeschool work.`)+table)+people+goals+
  card('Next',para(`Next story: Sunday ${short(shift(r.week.end,7))}, 6 pm reminder, 8 pm this email.`)),
  `Source: family dashboard weekly report (Quran OS, Notion surface log, Origins, homeschool log, Ansar OS, custm Meta, Nihal OS opens) and story links, ${short(r.week.start)}–${day(r.through)}, generated ${at(r.generatedAt)} Melbourne. Nothing is estimated; unknown values show as —.${unavailable.length?` Unavailable this run: ${esc(unavailable.join(', '))}.`:''}`);
 return {subject:`Family week ${weekLabel(r)}: ${watched}/${r.people.length} watched`,html};
}
function shift(iso:string,n:number){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}

export function reminderEmail(name:string,r:WeeklyReport,link:string){
 const html=shell(`Family week · ${weekLabel(r)}`,`${name}, this week’s story is ready`,
  'It takes about a minute. Watch it before we sit down tonight.',
  card('Watch the story',para(`Our goals, our Quran days, who showed up and what each of us did, ${weekLabel(r)}.`)+
   `<tr><td style="padding-top:6px"><table ${T}><tr><td style="background:${C.accent};border-radius:8px;padding:12px 20px"><a href="${esc(link)}" style="color:#ffffff;text-decoration:none;${txt(15,'#ffffff','font-weight:500')}">Watch this week’s story</a></td></tr></table></td></tr>`+
   para(`Or open: <a href="${esc(link)}" style="color:${C.link};text-decoration:none;${txt(14,C.link)}">${esc(link)}</a>`)),
  'Source: family dashboard weekly report. This link is yours: opening it tells the family dashboard you watched.');
 return {subject:`${name}, the family story for ${weekLabel(r)} is ready`,html};
}
