'use client';
import {useEffect,useState} from 'react';
import {civilDay,viewFor,type Mode,type Theme} from '../../lib/sunday/model';
import SundayReport from './SundayReport';
import GoalsIntermission from '../GoalsIntermission';
import OriginsNudges from '../OriginsNudges';
import CornerStack from '../CornerStack';
import TodayTogether from '../daily/TodayTogether';
const KEY='family-view-override';
const THEME_KEY='family-sunday-theme';
const DIRECTIONS:{id:Theme;name:string;detail:string}[]=[{id:'gather',name:'Gather',detail:'Spacious family overview'},{id:'scorecard',name:'Scorecard',detail:'Compact weekly focus'},{id:'mosaic',name:'Mosaic',detail:'A brighter family rhythm'}];
export default function SundayShell({preview=false,initialWeekly=false}:{preview?:boolean;initialWeekly?:boolean}){
 const [mode,setMode]=useState<Mode|null>(null),[theme,setTheme]=useState<Theme>('gather'),[manual,setManual]=useState(false),[today,setToday]=useState(civilDay());
 useEffect(()=>{
  function update(){const day=civilDay();setToday(day);let override=null;try{override=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}setMode(viewFor(day,override));setManual(override?.day===day);}
  const p=new URLSearchParams(window.location.search).get('theme');let saved=null;try{saved=localStorage.getItem(THEME_KEY);}catch{}const chosen=p||saved;if(DIRECTIONS.some(d=>d.id===chosen))setTheme(chosen as Theme);
  if(preview){setMode('weekly');}else {if(initialWeekly){try{localStorage.setItem(KEY,JSON.stringify({day:civilDay(),mode:'weekly'}));}catch{}}update();}
  const clock=setInterval(()=>{if(!preview)update();},15000);if(!preview)window.addEventListener('storage',update);
  return()=>{clearInterval(clock);window.removeEventListener('storage',update);};
 },[preview,initialWeekly]);
 // Nihal's incident counter + cycle switch live on her card in the daily view; the top bar hides its copy there.
 useEffect(()=>{document.documentElement.dataset.familyView=mode??'';return()=>{delete document.documentElement.dataset.familyView;};},[mode]);
 function chooseTheme(next:Theme){setTheme(next);try{localStorage.setItem(THEME_KEY,next);}catch{}const u=new URL(window.location.href);u.searchParams.set('theme',next);window.history.replaceState(null,'',u);}
 function choose(next:Mode){if(initialWeekly&&next==='daily')window.history.replaceState(null,'','/'+window.location.search);setMode(next);if(!preview){try{localStorage.setItem(KEY,JSON.stringify({day:civilDay(),mode:next}));}catch{}setManual(true);}}
 function automatic(){if(initialWeekly)window.history.replaceState(null,'','/'+window.location.search);try{localStorage.removeItem(KEY);}catch{}setManual(false);setMode(viewFor(civilDay()));}
 if(!mode)return <div className="su-boot" role="status">Opening the family dashboard…</div>;
 return <>
  <div className={`su-toolbar ${preview?'su-toolbar-preview':''}`}>
   <div className="su-mode-switch" aria-label="Dashboard view"><button type="button" aria-pressed={mode==='daily'} onClick={()=>choose('daily')}>Daily dashboard</button><button type="button" aria-pressed={mode==='weekly'} onClick={()=>choose('weekly')}>Weekly review</button></div>
   {preview?<span className="su-preview-badge">Preview · live sources, separate test entries</span>:<div className="su-schedule-label">{manual?<><span>Manual view for today</span><button onClick={automatic}>Restore Sunday schedule</button></>:<span>{viewFor(today)==='weekly'?'Sunday review is on automatically':'Weekly review opens automatically on Sunday'}</span>}</div>}
   {mode==='weekly'&&<div className="su-theme-picker" aria-label="Sunday design">{DIRECTIONS.map(d=><button type="button" key={d.id} title={d.detail} aria-pressed={theme===d.id} onClick={()=>chooseTheme(d.id)}>{d.name}</button>)}</div>}
  </div>
  {mode==='weekly'?<SundayReport theme={theme} preview={preview}/>:<div className="dashboard su-daily-dashboard"><GoalsIntermission/><OriginsNudges/><CornerStack/><TodayTogether/></div>}
 </>;
}
