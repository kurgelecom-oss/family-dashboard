'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {MANUAL_RULES, type WeeklyReport, type MemberId, type MetricKey, type Metric, type PersonReport, type Theme} from '../../lib/sunday/model';
import './sunday.css';
import {familyWrite} from '../FamilyEditGate';
const DAYS=['M','T','W','T','F','S','S'];
const DAY_NAMES=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const names:Record<MemberId,string>={taylan:'Taylan',nihal:'Nihal',ansar:'Ansar',ayah:'Ayah'};
const dateLabel=(iso:string)=>new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z'));
const timeLabel=(iso:string)=>new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit',timeZone:'Australia/Melbourne'}).format(new Date(iso));
function Dots({person,labels=false}:{person:PersonReport;labels?:boolean}){
 return <div className="su-days" aria-label={`${person.name} Quran attendance`}>
  {person.quran.days.map((d,i)=><div className="su-day" key={d.date}>
   {labels&&<span className="su-day-label">{DAYS[i]}</span>}
   <span tabIndex={0} className={'su-dot '+(!person.quran.available?'unknown':d.future?'future':d.sessions?'done':'empty')} aria-label={`${DAY_NAMES[i]} ${dateLabel(d.date)}: ${!person.quran.available?'source unavailable':d.future?'upcoming':d.sessions?`${d.sessions} finished session${d.sessions===1?'':'s'}`:'no finished session logged'}`} title={`${dateLabel(d.date)} · ${d.sessions} sessions · ${d.minutes} minutes`}>
    {!person.quran.available?'?':d.future?'·':d.sessions?'✓':'–'}
   </span>
  </div>)}
 </div>;
}
function QuranTable({report}:{report:WeeklyReport}){
 return <section className="su-quran" aria-labelledby="quran-heading">
  <div className="su-section-heading"><h2 id="quran-heading">Our week with Quran</h2><a href="https://quran-os.netlify.app/" target="_blank" rel="noreferrer">Open Quran OS ↗</a></div>
  <div className="su-quran-head"><span>Finished sessions</span><div className="su-days">{DAY_NAMES.map((d,i)=><span key={d}>{d.slice(0,3)} <small>{report.week.days[i].slice(-2)}</small></span>)}</div><span>Days</span><span>Sessions</span><span>Minutes</span></div>
  {report.people.map(p=><div className="su-quran-row" key={p.id} data-person={p.id}>
   <a className="su-person-name" href={`https://quran-os.netlify.app/m/${p.id}`} target="_blank" rel="noreferrer"><span className="su-initial">{p.name[0]}</span>{p.name}</a><Dots person={p} labels={p.id==='taylan'}/>
   <strong>{p.quran.available?`${p.quran.totalDays} / 7`:'—'}</strong><span>{p.quran.available?p.quran.sessions:'—'}</span><span>{p.quran.available?p.quran.minutes:'—'}</span>
  </div>)}
 </section>;
}
function MetricRow({metric:m,onEdit}:{metric:Metric;onEdit:()=>void}){
 const formatted=m.value===null?'—':m.unit==='AUD'?new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(m.value):`${m.value}${m.unit==='%'?'%':''}`;
 return <div className="su-metric" data-metric={m.key} title={m.detail}>
  <div><span className="su-metric-name">{m.label}</span><small title={m.detail}>{m.source==='missing'&&m.manualValue!==null?`${m.manualValue} extra saved · connected total unavailable`:m.backupIgnored?'Connected again · backup excluded':m.source==='manual'?'Manually recorded':m.source==='mixed'?`Connected + ${m.manualValue} manual`:m.detail}</small>{m.daily&&<div className="su-os-days" aria-label="Nihal OS opens by day">{m.daily.map((d,i)=><span key={d.date} aria-label={`${DAY_NAMES[i]}: ${d.count??'not tracked'}`} title={`${DAY_NAMES[i]} ${dateLabel(d.date)}: ${d.count??'not tracked'}`}><small>{DAY_NAMES[i].slice(0,3)}</small><b>{d.count??'—'}</b></span>)}</div>}</div>
  <strong>{formatted}</strong>
  {m.canEdit?<button type="button" className="su-add" onClick={onEdit} aria-label={`${m.manualValue!==null?'Edit':'Add'} ${m.label}`}>{m.manualValue!==null?'Edit':'+ Add'}</button>:<a className="su-auto" href={m.href} target="_blank" rel="noreferrer" title={m.detail}>Linked</a>}
 </div>;
}
function PersonCard({person:p,onEdit,compact=false}:{person:PersonReport;onEdit:(key:MetricKey)=>void;compact?:boolean}){
 return <article className="su-person" data-person={p.id}>
  <div className="su-person-heading"><div><span className="su-initial">{p.name[0]}</span><h2>{p.name}</h2></div><span className="su-person-focus">{p.id==='taylan'?'Build & launch':p.id==='nihal'?'Find & learn':p.id==='ansar'?'Learn & grow':'Little steps'}</span></div>
  {compact&&<div className="su-person-quran"><Dots person={p} labels/><p><b>{p.quran.available?p.quran.totalDays:'—'}/7</b> Quran days <span>{p.quran.available?p.quran.sessions:'—'} sessions</span></p></div>}
  <div className="su-metrics">{p.metrics.map(m=><MetricRow key={m.key} metric={m} onEdit={()=>{if(m.key!=='os_opens')onEdit(m.key);}}/>)}</div>
  {p.id==='ayah'&&<div className="su-ayah"><div className="su-petal" aria-hidden="true"><span/><span/><span/><span/><i/></div><div><strong>{p.quran.available?p.quran.totalDays:'—'} little steps</strong><p>Days with Quran this week.</p><small>{p.quran.available?`${p.quran.newAyahs} new ayahs · ${p.quran.minutes} minutes together`:'Quran connection unavailable'}</small></div></div>}
  <div className="su-win"><div><span>{p.win?'This week’s note':'One win. One next step.'}</span><p>{p.win||'Keep the next week simple.'}</p></div><button type="button" onClick={()=>onEdit('win')} aria-label={`Edit ${p.name} week note`}>{p.win?'Edit':'+ Note'}</button></div>
 </article>;
}
function EntryDialog({report,person,keyName,onClose,onSaved}:{report:WeeklyReport;person:MemberId;keyName:MetricKey;onClose:()=>void;onSaved:()=>void}){
 const [draft]=useState(()=>({existing:report.manual.find(r=>r.member===person&&r.metric===keyName),metric:report.people.find(p=>p.id===person)?.metrics.find(m=>m.key===keyName),week:report.week,preview:report.preview}));
 const existing=draft.existing;
 const rule=MANUAL_RULES[keyName];
 const [value,setValue]=useState(existing?.value?.toString()??'');const[note,setNote]=useState(existing?.note??'');const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 const ref=useRef<HTMLDialogElement>(null);
 const m=draft.metric;
 useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');
  try{const res=await familyWrite('/api/sunday',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({weekStart:draft.week.start,member:person,metric:keyName,value:rule.noteOnly?null:Number(value),mode:existing?.mode??m?.manualMode??'fallback',note,version:existing?.version??0})});const b=await res.json();if(!res.ok)throw new Error(b.error||'Not saved');onSaved();onClose();}catch(e){setError(e instanceof Error?e.message:'Not saved');}finally{setBusy(false);}
 }
 return <dialog ref={ref} className="su-dialog" onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}}>
  <form onSubmit={save}>
   <div className="su-dialog-top"><span>{names[person]} · {dateLabel(draft.week.start)}–{dateLabel(draft.week.end)}</span><button type="button" onClick={onClose} aria-label="Close entry">×</button></div>
   <h2>{rule.label}</h2>
   {!rule.noteOnly&&<><p>{keyName==='sleep'?'How many mornings did you go back to sleep after first waking? Enter 0 if none.':m?.manualMode==='supplement'?'Add only activity missing from the connected total. This is your extra count for the whole week.':m?.backupIgnored?'The connection is back. Your saved backup is kept here but is not added to the connected total.':'Enter the total for this week. You can edit it anytime.'}</p><label>Weekly {m?.manualMode==='supplement'?'additional ':''}total<input autoFocus type="number" min="0" max={rule.max} step={rule.decimal?'0.01':'1'} value={value} required onChange={e=>setValue(e.target.value)}/></label></>}
   <label>{rule.noteOnly?'A win, or a focus for next week':'Note (optional)'}<textarea autoFocus={rule.noteOnly} maxLength={600} rows={3} value={note} onChange={e=>setNote(e.target.value)}/></label>
   {draft.preview&&<p className="su-preview-note">Preview entry — kept separate from the live family records.</p>}
   {error&&<p role="alert" className="su-error">{error}</p>}
   <div className="su-dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy?'Saving…':'Save week'}</button></div>
  </form>
 </dialog>;
}
export default function SundayReport({theme='gather',preview=false}:{theme?:Theme;preview?:boolean}){
 const [report,setReport]=useState<WeeklyReport|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[sources,setSources]=useState(false);
 const [edit,setEdit]=useState<{person:MemberId;key:MetricKey}|null>(null);const[notice,setNotice]=useState('');const pending=useRef(false);
 const refresh=useCallback(async()=>{if(pending.current)return;pending.current=true;setLoading(true);try{const r=await fetch('/api/sunday',{cache:'no-store'});if(!r.ok)throw new Error('Report unavailable. Try refresh.');setReport(await r.json());setError('');}catch(e){setError(e instanceof Error?e.message:'Report unavailable');}finally{setLoading(false);pending.current=false;}},[]);
 useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),60000);window.addEventListener('focus',refresh);return()=>{clearInterval(id);window.removeEventListener('focus',refresh);};},[refresh]);
 if(!report)return <main className={`su-root su-${theme} su-loading`}><h1>The family week</h1><p role="status">{error||'Bringing the week together…'}</p>{error&&<button onClick={refresh}>Retry</button>}</main>;
 const totalSessions=report.people.reduce((n,p)=>n+p.quran.sessions,0);const totalDays=report.people.reduce((n,p)=>n+p.quran.totalDays,0);const allQuran=report.people.every(p=>p.quran.available);const connected=report.sources.filter(s=>s.state!=='unavailable').length;
 return <main className={`su-root su-${theme}`}>
  <header className="su-hero"><div><div className="su-edition">Kurgel family <span/> Sunday review</div><h1>{theme==='gather'?'This week, together.':theme==='scorecard'?'The week. In focus.':'Small steps. Shared wins.'}</h1><p>{dateLabel(report.week.start)} — {dateLabel(report.week.end)} <span>Monday to Sunday · Melbourne time</span></p></div><div className="su-hero-total"><strong>{allQuran?totalSessions:'—'}</strong><span>Quran sessions<br/>across our family</span><div className="su-family-dots" aria-hidden="true">{report.people.map(p=><i key={p.id} data-person={p.id}>{p.name[0]}</i>)}</div></div></header>
  {error&&<div className="su-error" role="alert">Refresh failed. Showing the last report from {timeLabel(report.generatedAt)}. <button onClick={refresh}>Retry</button></div>}
  <div className="su-content">
   {theme!=='scorecard'&&<QuranTable report={report}/>}
   <section className="su-people" aria-label="Each person's week">{report.people.map(p=><PersonCard key={p.id} person={p} compact={theme==='scorecard'} onEdit={key=>setEdit({person:p.id,key})}/>)}</section>
  </div>
  <footer className="su-footer"><p><span className="su-live-dot"/> {error?'Last loaded':'Updated'} {timeLabel(report.generatedAt)} <span className="su-footer-divider"/> {allQuran?`${totalDays} Quran days between us`:'Quran feed needs a refresh'} <span className="su-footer-divider"/> <span title="Older product logs are shared and do not name the finder">{report.shared.discoveries??'—'} products logged in the shared pipeline</span></p><div><button type="button" onClick={()=>setSources(!sources)} aria-expanded={sources}>{connected}/{report.sources.length} sources</button><button type="button" onClick={refresh} disabled={loading}>{loading?'Refreshing…':'Refresh data'}</button></div></footer>
  {notice&&<p className="su-notice" role="status">{notice}</p>}
  {sources&&<section className="su-sources"><div className="su-section-heading"><h2>Where the numbers come from</h2><button onClick={()=>setSources(false)}>Close</button></div>{report.sources.map(s=><a href={s.href} target="_blank" rel="noreferrer" key={s.id}><strong>{s.label}</strong><span data-state={s.state}>{s.state==='connected'?'Connected':s.state==='partial'?'Connected · some manual entries':'Unavailable'}</span><p>{s.detail}</p></a>)}</section>}
  {edit&&<EntryDialog report={{...report,preview:preview||report.preview}} person={edit.person} keyName={edit.key} onClose={()=>setEdit(null)} onSaved={()=>{setNotice('Week saved.');void refresh();}}/>}
 </main>;
}
