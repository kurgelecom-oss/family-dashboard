'use client';
import { useEffect, useRef, useState } from 'react';
import type { Row } from './ticker-rows';

/* One panel in place of the Nihal and TK columns: every daily task in one list
   that rolls upward, 4–7 rows in view. Each row starts as an empty circle and
   fills with a green tick when done — in Nihal OS, by its own app, or by a tap
   here. Hover (or a tap) holds the roll still so a row can be ticked.

   Order: Nihal's morning tasks, then her daily order of priority (Launchpad,
   the same ticks as Nihal OS), the ecom talk, then TK's list. The two
   level-ups that repeat a Notion task (product research, Origins) show once. */

const SECONDS_PER_ROW = 3.2;

export function DayTicker({ rows, fresh, onTick, title, sub }: { rows: Row[]; fresh: Set<string>; onTick: (r: Row) => void; title: string; sub: string }) {
  const [held, setHeld] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // A tap holds the roll for 8 s so the next tap lands on the same row.
  const hold = () => { setHeld(true); clearTimeout(timer.current); timer.current = setTimeout(() => setHeld(false), 8000); };
  const done = rows.filter(r => r.done).length;
  const roll = rows.length > 5;

  const tap = (r: Row) => {
    hold();
    if (!r.tick || r.locked) { setNudge(r.id); setTimeout(() => setNudge(null), 700); return; }
    onTick(r);
  };
  const row = (r: Row, copy: number) => (
    <li key={`${copy}-${r.id}`} aria-hidden={copy ? true : undefined}
      className={'dt-row' + (r.done ? ' done' : '') + (r.tick && !r.locked ? ' tap' : '') + (r.locked ? ' locked' : '') + (fresh.has(r.id) ? ' fresh' : '') + (nudge === r.id ? ' nudge' : '')}
      onClick={() => tap(r)} title={r.done ? 'Done' : !r.tick ? 'Ticks itself' : r.locked ? 'Finish the task above first' : 'Tap to tick'}>
      <span className="dt-circle" aria-label={r.done ? 'done' : 'not done'}><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" /></svg></span>
      <span className="dt-body">
        <span className="dt-title">{r.step && <em>{r.step}</em>}{r.title}</span>
        {r.talk && <span className="dt-talk">{r.talk}</span>}
      </span>
      <span className={'dt-who ' + r.who.toLowerCase()}>{r.who}</span>
      <span className="dt-hint">{r.hint ?? ''}</span>
    </li>
  );

  return (
    <section className="hb-card dt" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onPointerDown={hold}>
      <div className="hb-head">
        <div><h2>{title}</h2><p>{sub}</p></div>
        <div className="dt-count"><b className="hb-num">{done}</b><span>of {rows.length}</span><div className="dt-bar"><i style={{ width: `${rows.length ? done / rows.length * 100 : 0}%` }} /></div></div>
      </div>
      {!rows.length ? <p className="hb-empty">Loading the day…</p> :
        <div className={'dt-view' + (roll ? ' roll' : '')}>
          <ul className={'dt-track' + (held ? ' held' : '')} style={roll ? { animationDuration: `${rows.length * SECONDS_PER_ROW}s` } : undefined}>
            {rows.map(r => row(r, 0))}
            {roll && rows.map(r => row(r, 1))}
          </ul>
        </div>}
    </section>
  );
}
