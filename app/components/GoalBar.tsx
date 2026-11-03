'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { familyWrite } from './FamilyEditGate';
import './goal-bar.css';

/* Goal bar (tk, 3 Nov 2026, Option D "week + horizon rail"). 30px under the nav on every board, in the
   --strip-h slot every surface already subtracts. Left zone: this week's goals under one Mon→Sun fuse,
   reset each Monday. Right zone: dated goals, each with its own fuse and ember burning to its due date.
   Percentages, counts and days only — never balances. Tap → the goal list; edits ask for the family PIN. */

type Measure = { pct?: number; txt?: string; hit?: boolean };
type Goal = { id: string; rank: number; goal: string; short: string; range: string; priority: number | null; how: string; metric: string; target: number | null; due: string | null; measure: Measure | null };
type Draft = Omit<Goal, 'measure' | 'id' | 'rank'> & { id?: string; key: string };

const DAY = 864e5;
const RANGES: [string, string][] = [['wk', 'Weekly'], ['1m', '1 month'], ['3m', '3 months'], ['6m', '6 months'], ['12m', '12 months']];
const PRI: [string, string][] = [['', '—'], ['1', '1 · Critical'], ['2', '2 · High'], ['3', '3 · Medium'], ['4', '4 · Low']];
const SET_FROM = new Date(2026, 10, 1); // fuses on the seeded goals start when the list was set, 1 Nov 2026
const dueAt = (iso: string) => new Date(iso + 'T23:59:59');
const endOfMonthAfter = (n: number) => { const t = new Date(); const d = new Date(t.getFullYear(), t.getMonth() + n, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DUE_FOR: Record<string, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 };

function Fuse({ f, wide }: { f: number; wide?: boolean }) {
  const p = `${Math.round(Math.min(1, Math.max(0, f)) * 1000) / 10}%`;
  return <span className={'gb-fuse' + (wide ? ' wide' : '')} aria-hidden="true"><u style={{ width: p }} /><i style={{ left: p }} /><b style={{ left: p }} /></span>;
}

function val(m: Measure | null) {
  if (!m) return null;
  return m.txt ?? (m.pct !== undefined ? `${m.pct}%` : null);
}

export default function GoalBar() {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch('/api/goals', { cache: 'no-store' }); if (r.ok) setGoals((await r.json()).goals); } catch { /* keep the last good list */ }
  }, []);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const a = setInterval(load, 5 * 60_000), b = setInterval(() => setNow(new Date()), 60_000);
    const vis = () => { if (!document.hidden) { void load(); setNow(new Date()); } };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('goals-changed', load);
    return () => { clearTimeout(first); clearInterval(a); clearInterval(b); document.removeEventListener('visibilitychange', vis); window.removeEventListener('goals-changed', load); };
  }, [load]);

  if (!goals) return <div className="gb" aria-hidden="true" />;
  const dow = (now.getDay() + 6) % 7, wkFrac = (dow + now.getHours() / 24) / 7;
  const wk = goals.filter(g => g.range === 'wk'), hz = goals.filter(g => g.range !== 'wk');

  const cell = (g: Goal, extra: string | null, fuse?: React.ReactNode, ask?: boolean) => {
    const v = val(g.measure), hit = !!g.measure?.hit;
    return <span key={g.id} className={'gb-c' + (g.priority === 1 ? ' p1' : '') + (hit ? ' hit' : '') + (ask ? ' ask' : '')} title={g.goal}>
      <span className="gb-rk">{hit ? '✓' : g.rank}</span><em>{g.short}</em>
      <span className="gb-mx">{ask ? 'Due · done or missed?' : <>{v && <b>{v}</b>}{v && extra ? ' · ' : ''}{extra}{!v && !extra ? '—' : ''}</>}</span>{fuse}
    </span>;
  };

  return <>
    <button type="button" className="gb" onClick={() => setOpen(true)} aria-label="Family goals — open the list">
      {wk.length > 0 && <span className="gb-z wk">
        <span className="gb-zl">This week<b>{7 - dow}d left</b></span>
        {wk.map(g => cell(g, null))}
        <Fuse f={wkFrac} wide />
      </span>}
      <span className="gb-z hz">
        <span className="gb-zl">Ahead<b>by date</b></span>
        {hz.map(g => {
          if (!g.due) return cell(g, null);
          const due = dueAt(g.due), left = Math.ceil((due.getTime() - now.getTime()) / DAY), f = (now.getTime() - SET_FROM.getTime()) / (due.getTime() - SET_FROM.getTime());
          return cell(g, left > 0 ? `${left}d` : null, <Fuse f={f} />, left <= 0);
        })}
      </span>
    </button>
    {open && <GoalEditor goals={goals} onClose={() => setOpen(false)} onSaved={(g) => { setGoals(g); window.dispatchEvent(new Event('goals-changed')); }} />}
  </>;
}

function GoalEditor({ goals, onClose, onSaved }: { goals: Goal[]; onClose: () => void; onSaved: (g: Goal[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<Draft[]>(() => goals.map(g => ({ id: g.id, key: g.id, goal: g.goal, short: g.short, range: g.range, priority: g.priority, how: g.how, metric: g.metric, target: g.target, due: g.due })));
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);

  const set = (i: number, patch: Partial<Draft>) => { setDirty(true); setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x)); };
  const move = (i: number, d: number) => { setDirty(true); setRows(r => { const n = r.slice(); const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; }); };

  async function save() {
    setBusy(true); setMsg('');
    try {
      const r = await familyWrite('/api/goals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goals: rows.filter(x => x.goal.trim()) }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Not saved');
      onSaved(b.goals); setDirty(false); setMsg('Saved.');
      setRows(b.goals.map((g: Goal) => ({ id: g.id, key: g.id, goal: g.goal, short: g.short, range: g.range, priority: g.priority, how: g.how, metric: g.metric, target: g.target, due: g.due })));
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Not saved'); } finally { setBusy(false); }
  }
  async function settle(id: string, outcome: 'done' | 'missed') {
    if (dirty) { setMsg('Save your edits first.'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await familyWrite('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, outcome }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || 'Not saved');
      onSaved(b.goals); setRows(rs => rs.filter(x => x.id !== id)); setMsg(outcome === 'done' ? 'Logged as done. Add the next goal.' : 'Logged as missed. Add the next goal.');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Not saved'); } finally { setBusy(false); }
  }
  const [warned, setWarned] = useState(false);
  const close = () => {
    if (dirty && !warned) { setWarned(true); setMsg('Unsaved edits — Save, or close again to drop them.'); return; }
    ref.current?.close(); onClose();
  };

  return <dialog ref={ref} className="gb-ed" onCancel={(e) => { e.preventDefault(); close(); }}>
    <header><h2>Family goals</h2><span>Order = rank. Edits ask for the family PIN.</span><button type="button" onClick={close} aria-label="Close">×</button></header>
    <ol>{rows.map((g, i) => <li key={g.key} className={g.priority === 1 ? 'p1' : ''}>
      <span className="n">{i + 1}</span>
      <input aria-label="Goal" value={g.goal} maxLength={200} onChange={e => set(i, { goal: e.target.value })} placeholder="Goal" />
      <input aria-label="Short name on the bar" value={g.short} maxLength={40} onChange={e => set(i, { short: e.target.value })} placeholder="Bar name" />
      <select aria-label="Priority" value={g.priority ?? ''} onChange={e => set(i, { priority: e.target.value ? Number(e.target.value) : null })}>{PRI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select aria-label="Range" value={g.range} onChange={e => { const range = e.target.value; set(i, { range, due: range === 'wk' ? null : endOfMonthAfter(DUE_FOR[range]), metric: range === 'wk' ? (g.metric === 'date' ? 'none' : g.metric) : g.metric === 'none' ? 'date' : g.metric }); }}>{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {g.range === 'wk' ? <span className="dim">resets Mon</span> : <input aria-label="Due date" type="date" value={g.due ?? ''} onChange={e => set(i, { due: e.target.value || null })} />}
      <span className="mv"><button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button><button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button></span>
      <span className="st">{g.id && g.range !== 'wk' ? <><button type="button" disabled={busy} onClick={() => settle(g.id!, 'done')}>Done</button><button type="button" disabled={busy} onClick={() => settle(g.id!, 'missed')}>Missed</button></> : null}
        <button type="button" className="rm" onClick={() => { setDirty(true); setRows(r => r.filter((_, j) => j !== i)); }} aria-label="Remove goal">Remove</button></span>
      {g.how && <small className="how">{g.how}</small>}
    </li>)}</ol>
    <footer>
      <button type="button" disabled={rows.length >= 10} onClick={() => { setDirty(true); setRows(r => [...r, { key: 'n' + Date.now(), goal: '', short: '', range: '1m', priority: null, how: '', metric: 'date', target: null, due: endOfMonthAfter(1) }]); }}>+ Add goal</button>
      <span role="status">{msg}</span>
      <button type="button" className="save" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </footer>
  </dialog>;
}
