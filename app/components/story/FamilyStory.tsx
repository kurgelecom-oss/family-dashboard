'use client';
// This week's family story: this week's and last week's Sunday reports → buildStory → StoryPlayer. Read-only, except that a
// signed personal link (?who&w&k from the Sunday reminder) records that this person opened and finished it.
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {StoryPlayer,Big,Dots,Bars,Cards,Stats} from './StoryPlayer';
import {buildStory,type Scene} from '../../lib/story/model';
import {civilDay,shiftDay,weekFor,type WeeklyReport} from '../../lib/sunday/model';
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
 const [report,setReport]=useState<WeeklyReport|null>(null),[last,setLast]=useState<WeeklyReport|null>(null),[error,setError]=useState('');
 const link=useRef<{who:string;w:string;k:string}|null>(null);
 const track=useCallback((event:'open'|'finish')=>{const l=link.current;if(l)void fetch('/api/story/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...l,event}),keepalive:true}).catch(()=>{});},[]);
 // This week and last week, fresh. Re-read every 10 minutes; a new Monday gives a new week, so the story rebuilds and starts over.
 const load=useCallback(async()=>{
  try{
   const r=await fetch('/api/sunday',{cache:'no-store'});if(!r.ok)throw new Error();const now:WeeklyReport=await r.json();setReport(now);setError('');
   const l=await fetch(`/api/sunday?week=${shiftDay(now.week.start,-7)}`,{cache:'no-store'});setLast(l.ok?await l.json():null);
  }catch{setError('The story could not load. Refresh to try again.');}
 },[]);
 useEffect(()=>{
  const q=new URLSearchParams(location.search),who=q.get('who'),w=q.get('w'),k=q.get('k');
  if(who&&w&&k){link.current={who,w,k};track('open');}
  void load();
  let week=weekFor(civilDay()).start,n=0;
  const id=setInterval(()=>{const now=weekFor(civilDay()).start;if(now!==week){week=now;setReport(null);setLast(null);void load();}else if(++n%10===0)void load();},60000);
  return()=>clearInterval(id);
 },[track,load]);
 const scenes=useMemo(()=>report?buildStory(report,last):[],[report,last]);
 const finish=useCallback(()=>track('finish'),[track]);
 if(!report)return <p className="sty-empty" role="status">{error||'Building this week’s story…'}</p>;
 return <StoryPlayer scenes={scenes} storageKey={`family-story-${report.week.start}`} timingKey="family-story-timing" onEnd={finish} brand={<>Kurgel family · {range(report)}</>} render={(s,p)=><Visual s={s} p={p}/>}/>;
}
