'use client';
// This week's family story: the live Sunday report → buildStory → StoryPlayer. Read-only, except that a
// signed personal link (?who&w&k from the Sunday reminder) records that this person opened and finished it.
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {StoryPlayer,Big,Dots,Bars,Cards,Stats} from './StoryPlayer';
import {buildStory,type Scene} from '../../lib/story/model';
import type {WeeklyReport} from '../../lib/sunday/model';
import './story.css';

function Visual({s,p}:{s:Scene;p:number}){
 if(s.id==='goals')return <div className="sty-goals">{s.goals.map((g,i)=><div key={i} style={{opacity:Math.min(1,p*1.6-i*.2)}}><small>Goal {i+1}</small><b>{g.short}</b><span>{g.label}{g.pct!==null?` · ${g.pct}%`:''}</span></div>)}</div>;
 if(s.id==='quran')return <div className="sty-split"><Big v={Math.round(s.on*p)} l={`of ${s.total} Quran days`}/><Dots total={s.total} on={s.on} p={p}/></div>;
 if(s.id==='showed')return <Bars bars={s.bars} p={p}/>;
 if(s.id==='next')return <Cards cards={s.cards} p={p}/>;
 return <Stats stats={s.stats} p={p}/>;
}
const d=(iso:string)=>new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z'));
const range=(r:WeeklyReport)=>`${d(r.week.start)}–${d(r.week.end)}`;
export default function FamilyStory(){
 const [report,setReport]=useState<WeeklyReport|null>(null),[error,setError]=useState('');
 const link=useRef<{who:string;w:string;k:string}|null>(null);
 const track=useCallback((event:'open'|'finish')=>{const l=link.current;if(l)void fetch('/api/story/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...l,event}),keepalive:true}).catch(()=>{});},[]);
 useEffect(()=>{
  const q=new URLSearchParams(location.search),who=q.get('who'),w=q.get('w'),k=q.get('k');
  if(who&&w&&k){link.current={who,w,k};track('open');}
  fetch('/api/sunday',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(setReport).catch(()=>setError('The story could not load. Refresh to try again.'));
 },[track]);
 const scenes=useMemo(()=>report?buildStory(report):[],[report]);
 const finish=useCallback(()=>track('finish'),[track]);
 if(!report)return <p className="sty-empty" role="status">{error||'Building this week’s story…'}</p>;
 return <StoryPlayer scenes={scenes} storageKey={`family-story-${report.week.start}`} onEnd={finish} brand={<>Kurgel family · {range(report)}</>} render={(s,p)=><Visual s={s} p={p}/>}/>;
}
