'use client';
import {useEffect,useRef,useState} from 'react';
/** Retry a write after the household unlocks editing, without losing the draft. */
export async function familyWrite(url:string,init:RequestInit){
 const response=await fetch(url,init);if(response.status!==401)return response;
 const unlocked=await new Promise<boolean>(resolve=>window.dispatchEvent(new CustomEvent('family-edit-unlock',{detail:{resolve}})));
 return unlocked?fetch(url,init):response;
}
export default function FamilyEditGate(){
 const [request,setRequest]=useState<{resolve:(ok:boolean)=>void}|null>(null),[pin,setPin]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const handler=(e:Event)=>{setPin('');setError('');setRequest((e as CustomEvent).detail);};window.addEventListener('family-edit-unlock',handler);return()=>window.removeEventListener('family-edit-unlock',handler);},[]);
 useEffect(()=>{if(request)ref.current?.showModal();},[request]);
 function close(ok:boolean){request?.resolve(ok);ref.current?.close();setRequest(null);}
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);try{const r=await fetch('/api/family-unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});const b=await r.json();if(!r.ok)throw new Error(b.error);close(true);}catch(e){setError(e instanceof Error?e.message:'Could not unlock');}finally{setBusy(false);}}
 return request?<dialog ref={ref} className="family-edit-dialog" onCancel={()=>close(false)}><form onSubmit={submit}><h2>Unlock family editing</h2><p>Use the family PIN. This device will remember it.</p><label>Family PIN<input type="password" autoFocus inputMode="numeric" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value)} required/></label>{error&&<p role="alert">{error}</p>}<div><button type="button" onClick={()=>close(false)}>Cancel</button><button disabled={busy} type="submit">{busy?'Unlocking…':'Unlock & continue'}</button></div></form></dialog>:null;
}
