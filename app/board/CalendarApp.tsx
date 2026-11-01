'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './board.css';
import { familyWrite } from '../components/FamilyEditGate';
import {
  addDays, addMonths, clock, dayNum, monthAbbr, monthGrid, monthName, range, startOfMonth, startOfWeek,
  today as todayDay, wall, weekdayLong, weekdayShort, zonedToISO,
} from '../lib/cal-time';
import Strip from './Strip';
import Ink from './Ink';
import EventAlerts, { previewAlert, type AlertMode } from '../components/EventAlerts';

/* The family calendar. Apple Calendar's layout and gestures, the home board's
   "Climb" palette. Everything is reachable by a single tap on a 65" Flip:
   tap an empty slot → new event; tap an event → edit it; hold an event → drag it
   (bottom edge = resize); swipe sideways → previous / next. */

type View = 'day' | 'week' | 'month' | 'year';
type Source = 'board' | 'outlook' | 'google' | 'routine';
type Raw = { id: string; key?: string; cal: string; title: string; startISO: string; endISO: string; allDay: boolean; source?: Source; link?: string; notes?: string };
type Ev = Raw & { key: string; source: Source; s: number; e: number; sd: string; ed: string; band: boolean };
type Draft = { id?: string; cal: string; title: string; day: string; startMin: number; endMin: number; allDay: boolean; notes: string; alert: AlertMode | 'off' };

export const CALS: { id: string; label: string; writable: boolean }[] = [
  { id: 'family', label: 'Family', writable: true },
  { id: 'taylan', label: 'TK', writable: true },
  { id: 'nihal', label: 'Nihal', writable: true },
  { id: 'ansar', label: 'Ansar', writable: true },
  { id: 'kurgel', label: 'Kurgel (Google)', writable: false },
  { id: 'routine', label: 'Routines (Notion)', writable: false },
];
const SOURCE_NAME: Record<Source, string> = { board: 'Family calendar', outlook: 'Outlook', google: 'Google Calendar', routine: 'Notion routine' };
const HOUR = 64, SNAP = 15, HOLD_MS = 350;
const VIEWS: View[] = ['day', 'week', 'month', 'year'];
const color = (cal: string) => `var(--c-${CALS.some(c => c.id === cal) ? cal : 'routine'})`;

function normalise(r: Raw, source: Source): Ev {
  const s = Date.parse(r.startISO), e = Math.max(Date.parse(r.endISO), s);
  // Outlook writes all-day dates as UTC midnights; everything else is a Melbourne midnight.
  const dayOf = (iso: string) => r.allDay && source === 'outlook' ? iso.slice(0, 10) : wall(iso).day;
  const sd = dayOf(r.startISO);
  let ed = r.allDay ? dayOf(r.endISO) : wall(new Date(Math.max(s, e - 1))).day;
  if (r.allDay && ed <= sd) ed = addDays(sd, 1);
  if (!r.allDay) ed = addDays(ed, 1);
  return { ...r, key: r.key ?? `board-${r.id}`, source, s, e, sd, ed, band: r.allDay || e - s >= 864e5 };
}

/** Columns for overlapping timed events in one day: Apple's side-by-side split. */
function layout(items: { ev: Ev; top: number; bot: number }[]) {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.bot - a.bot);
  const out: { ev: Ev; top: number; bot: number; col: number; cols: number }[] = [];
  let cluster: typeof out = [], ends: number[] = [], clusterEnd = -1;
  const flush = () => { cluster.forEach(c => (c.cols = ends.length)); out.push(...cluster); cluster = []; ends = []; };
  for (const it of sorted) {
    if (it.top >= clusterEnd) { flush(); clusterEnd = -1; }
    let col = ends.findIndex(end => end <= it.top);
    if (col < 0) { col = ends.length; ends.push(it.bot); } else ends[col] = it.bot;
    cluster.push({ ...it, col, cols: 0 });
    clusterEnd = Math.max(clusterEnd, it.bot);
  }
  flush();
  return out;
}

function readUrl(): { view: View; anchor: string } {
  const q = new URLSearchParams(window.location.search);
  const v = q.get('view') as View, d = q.get('d') ?? '';
  return { view: VIEWS.includes(v) ? v : 'week', anchor: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayDay() };
}

export default function CalendarApp() {
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => todayDay());
  const [now, setNow] = useState(() => new Date());
  const [ext, setExt] = useState<Ev[]>([]);
  const [own, setOwn] = useState<Ev[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set(['routine']));
  const [calsOpen, setCalsOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<Ev | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ink, setInk] = useState(false);
  const [toast, setToast] = useState('');
  const [alerts, setAlerts] = useState<Record<string, AlertMode>>({});
  const loadAlerts = useCallback(() => fetch('/api/cal/alerts', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(b => b?.alerts && setAlerts(b.alerts)).catch(() => {}), []);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);
  const [drag, setDrag] = useState<{ id: string; dDay: number; dTop: number; dBot: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const lastTouch = useRef(0);
  // Month cells hold as many event lines as fit; the rest become "N more" (never clipped).
  const [mgridH, setMgridH] = useState(600);
  const mgridRO = useRef<ResizeObserver | null>(null);
  const mgrid = useCallback((el: HTMLDivElement | null) => {
    mgridRO.current?.disconnect();
    if (el) { mgridRO.current = new ResizeObserver(([e]) => setMgridH(e.contentRect.height)); mgridRO.current.observe(el); }
  }, []);

  const today = wall(now).day;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL and localStorage only exist after mount
  useEffect(() => { const u = readUrl(); setView(u.view); setAnchor(u.anchor); try { const h = localStorage.getItem('cal-hidden'); if (h) setHidden(new Set(JSON.parse(h))); } catch {} }, []);
  useEffect(() => { const q = new URLSearchParams(window.location.search); q.set('view', view); q.set('d', anchor); history.replaceState(null, '', `?${q}`); }, [view, anchor]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);

  // The TV is left on all day: after 10 idle minutes it drifts back to today, so a
  // screen someone paged to last Tuesday never sits there pretending to be now.
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); };
    touch();
    window.addEventListener('pointerdown', touch); window.addEventListener('keydown', touch);
    const t = setInterval(() => { if (Date.now() - lastTouch.current > 10 * 60_000 && !draft && !ink) setAnchor(a => (a === todayDay() ? a : todayDay())); }, 60_000);
    return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); clearInterval(t); };
  }, [draft, ink]);

  const days = useMemo(() => view === 'day' ? [anchor] : view === 'week' ? range(startOfWeek(anchor), 7) : view === 'month' ? monthGrid(anchor) : [], [view, anchor]);
  const from = days[0], to = days.length ? addDays(days[days.length - 1], 1) : '';

  const loadOwn = useCallback(async () => {
    if (!from) return;
    const r = await fetch(`/api/cal/events?from=${from}&to=${to}`, { cache: 'no-store' });
    if (r.ok) setOwn(((await r.json()).events as Raw[]).map(e => normalise(e, 'board')));
  }, [from, to]);
  const loadExt = useCallback(async () => {
    if (!from) return;
    try {
      const r = await fetch(`/api/cal?from=${from}&to=${to}`);
      const b = await r.json() as { events?: Raw[]; errors?: string[]; missing?: string[] };
      setExt((b.events ?? []).map(e => normalise(e, e.source ?? 'outlook')));
      setProblems([...(b.errors ?? []), ...(b.missing ?? []).map(m => `${m} not connected`)]);
    } catch { setProblems(['Calendars not answering — showing the family calendar only']); }
  }, [from, to]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a new page must not show the old page's events while it loads
  useEffect(() => { setOwn([]); setExt([]); loadOwn(); loadExt(); }, [loadOwn, loadExt]);
  // Polling pauses while hidden (Netlify bills per request).
  useEffect(() => {
    const a = setInterval(() => { if (!document.hidden) loadOwn(); }, 60_000), b = setInterval(() => { if (!document.hidden) loadExt(); }, 5 * 60_000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [loadOwn, loadExt]);

  // Scroll the time grid to 7 am (or an hour before now on today) when the page changes.
  useEffect(() => {
    if (!scroller.current || (view !== 'day' && view !== 'week')) return;
    const m = days.includes(today) ? Math.max(0, wall(new Date()).min - 90) : 7 * 60;
    scroller.current.scrollTop = m / 60 * HOUR;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on page change
  }, [view, from]);

  const events = useMemo(() => [...own, ...ext].filter(e => !hidden.has(e.cal)), [own, ext, hidden]);

  function step(n: number) {
    setSelected(null);
    setAnchor(a => view === 'day' ? addDays(a, n) : view === 'week' ? addDays(a, 7 * n) : view === 'month' ? addMonths(a, n) : addMonths(a, 12 * n));
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (draft || detail || calsOpen || (e.target as HTMLElement)?.closest?.('input,textarea')) return;
      if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); else if (e.key === 't') setAnchor(todayDay());
      else { const v = VIEWS.find(x => x[0] === e.key); if (v) setView(v); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500); }
  function toggleCal(id: string) { setHidden(h => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); localStorage.setItem('cal-hidden', JSON.stringify([...n])); return n; }); }

  function openEvent(ev: Ev) {
    setSelected(ev.id);
    if (ev.source !== 'board') { setDetail(ev); return; }
    const sw = wall(new Date(ev.s)), ew = wall(new Date(ev.e));
    setDraft({ id: ev.id, alert: alerts[ev.key] ?? 'off', cal: ev.cal, title: ev.title, notes: ev.notes ?? '', allDay: ev.allDay, day: ev.allDay ? ev.sd : sw.day, startMin: ev.allDay ? 9 * 60 : sw.min, endMin: ev.allDay ? 10 * 60 : ew.day === sw.day ? ew.min : 24 * 60 });
  }
  const newAt = (day: string, startMin = 9 * 60, allDay = false) => setDraft({ alert: 'off', cal: 'family', title: '', notes: '', day, startMin, endMin: Math.min(24 * 60, startMin + 60), allDay });

  async function save(d: Draft) {
    const body = { id: d.id, cal: d.cal, title: d.title, notes: d.notes, allDay: d.allDay,
      startISO: zonedToISO(d.day, d.allDay ? 0 : d.startMin), endISO: d.allDay ? zonedToISO(addDays(d.day, 1), 0) : zonedToISO(d.day, d.endMin) };
    const r = await familyWrite('/api/cal/events', { method: d.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return b.error ?? 'Could not save';
    const ev = normalise(b.event, 'board');
    setOwn(list => [...list.filter(x => x.id !== ev.id), ev]);
    if ((alerts[ev.key] ?? 'off') !== d.alert) { const err = await setAlert(ev.key, d.alert); if (err) flash(err); }
    setDraft(null); flash(d.id ? 'Saved' : `Added “${ev.title}”`);
    return null;
  }
  async function setAlert(key: string, mode: AlertMode | 'off') {
    const r = await familyWrite('/api/cal/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, mode }) });
    if (!r.ok) return 'Pop-up not saved — unlock editing';
    setAlerts(a => { const n = { ...a }; if (mode === 'off') delete n[key]; else n[key] = mode; return n; });
    window.dispatchEvent(new Event('event-alerts-changed'));
    return null;
  }
  async function remove(id: string) {
    const r = await familyWrite(`/api/cal/events?id=${id}`, { method: 'DELETE' });
    if (!r.ok) return (await r.json().catch(() => ({}))).error ?? 'Could not delete';
    setOwn(list => list.filter(x => x.id !== id)); setDraft(null); flash('Deleted');
    return null;
  }

  /* ── gestures on the time grid ───────────────────────────────────────────── */
  const dragEnd = useRef(0);
  const gesture = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);
  const dragRef = useRef<{ ev: Ev; mode: 'move' | 'resize'; x: number; y: number; dayIdx: number; armed: boolean; timer?: ReturnType<typeof setTimeout>; pid: number } | null>(null);

  // A held event must stop the page scrolling; only a non-passive touchmove can do that.
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const block = (e: TouchEvent) => { if (dragRef.current?.armed) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [view]);

  const minuteAt = (clientY: number) => { const r = grid.current!.getBoundingClientRect(); return Math.max(0, Math.min(24 * 60, (clientY - r.top) / HOUR * 60)); };
  const dayIdxAt = (clientX: number) => { const r = grid.current!.getBoundingClientRect(); return Math.max(0, Math.min(days.length - 1, Math.floor((clientX - r.left) / (r.width / days.length)))); };

  function bodyDown(e: React.PointerEvent) { gesture.current = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false }; }
  function bodyMove(e: React.PointerEvent) {
    const g = gesture.current; if (g && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) g.moved = true;
    const d = dragRef.current; if (!d) return;
    if (!d.armed) { if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) { clearTimeout(d.timer); dragRef.current = null; } return; }
    const dMin = Math.round((minuteAt(e.clientY) - minuteAt(d.y)) / SNAP) * SNAP;
    setDrag({ id: d.ev.id, dDay: d.mode === 'move' ? dayIdxAt(e.clientX) - d.dayIdx : 0, dTop: d.mode === 'move' ? dMin : 0, dBot: dMin });
  }
  function bodyUp(e: React.PointerEvent) {
    const g = gesture.current; gesture.current = null;
    const d = dragRef.current;
    if (d) { clearTimeout(d.timer); dragRef.current = null; if (d.armed) { finishDrag(d, e); return; } }
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) > 120 && Math.abs(dx) > 2 * Math.abs(dy)) { step(dx < 0 ? 1 : -1); return; }
    if (g.moved || !grid.current || (e.target as HTMLElement).closest('.cal-ev')) return;
    const r = grid.current.getBoundingClientRect();
    if (e.clientX < r.left || e.clientY < r.top) return;
    if (selected) { setSelected(null); return; }
    newAt(days[dayIdxAt(e.clientX)], Math.floor(minuteAt(e.clientY) / 30) * 30);
  }
  function clickEvent(e: React.MouseEvent, ev: Ev) { e.stopPropagation(); if (Date.now() - dragEnd.current > 400) openEvent(ev); }
  function evDown(e: React.PointerEvent, ev: Ev, dayIdx: number) {
    if (ev.source !== 'board' || ink) return;
    const el = e.currentTarget as HTMLElement, rect = el.getBoundingClientRect();
    const mode = e.clientY > rect.bottom - 18 ? 'resize' : 'move';
    const d = { ev, mode, x: e.clientX, y: e.clientY, dayIdx, armed: e.pointerType === 'mouse', pid: e.pointerId } as NonNullable<typeof dragRef.current>;
    if (!d.armed) d.timer = setTimeout(() => { d.armed = true; setSelected(ev.id); setDrag({ id: ev.id, dDay: 0, dTop: 0, dBot: 0 }); navigator.vibrate?.(10); }, HOLD_MS);
    dragRef.current = d;
  }
  async function finishDrag(d: NonNullable<typeof dragRef.current>, e: React.PointerEvent) {
    const p = drag; setDrag(null);
    // A hold with no movement falls through to the click, which opens the editor.
    if (!p || (p.dDay === 0 && p.dTop === 0 && p.dBot === 0)) { if (e.pointerType !== 'mouse') openEvent(d.ev); return; }
    dragEnd.current = Date.now();
    const ev = d.ev, dur = ev.e - ev.s;
    const s = wall(new Date(ev.s));
    const day = addDays(s.day, p.dDay);
    const startMin = Math.max(0, Math.min(24 * 60 - SNAP, s.min + p.dTop));
    const startISO = zonedToISO(day, startMin);
    const endISO = d.mode === 'move' ? new Date(Date.parse(startISO) + dur).toISOString() : new Date(Math.max(Date.parse(startISO) + SNAP * 60_000, ev.e + p.dBot * 60_000)).toISOString();
    const moved = normalise({ ...ev, startISO, endISO }, 'board');
    setOwn(list => list.map(x => x.id === ev.id ? moved : x));
    const r = await familyWrite('/api/cal/events', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ev.id, cal: ev.cal, title: ev.title, notes: ev.notes, allDay: false, startISO, endISO }) });
    if (!r.ok) { setOwn(list => list.map(x => x.id === ev.id ? ev : x)); flash('Could not move it — unlock editing and try again'); }
    else flash(`Moved to ${weekdayShort(day)} ${clock(startMin)}`);
  }

  /* ── pieces ─────────────────────────────────────────────────────────────── */
  const title = view === 'day' ? <><b>{dayNum(anchor)} {monthName(anchor)}</b> {anchor.slice(0, 4)}<small>{weekdayLong(anchor)}</small></>
    : view === 'year' ? <b>{anchor.slice(0, 4)}</b>
    : <><b>{monthName(anchor)}</b> {anchor.slice(0, 4)}</>;

  const inkScope = view === 'day' ? `day:${anchor}` : view === 'week' ? `week:${startOfWeek(anchor)}` : view === 'month' ? `month:${anchor.slice(0, 7)}` : `year:${anchor.slice(0, 4)}`;

  function TimeGrid() {
    const nowMin = wall(now).min;
    const bands = days.map(day => events.filter(e => e.band && e.sd <= day && e.ed > day));
    const bandRows = Math.max(1, ...bands.map(b => b.length));
    return (
      <div className={'cal-tg ' + view}>
        <div className="cal-heads" style={{ gridTemplateColumns: `var(--gutter) repeat(${days.length}, 1fr)` }}>
          <span />
          {days.map(d => {
            const wk = [5, 6].includes((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7);
            return <button key={d} className={'cal-head' + (wk ? ' wkend' : '') + (d === today ? ' today' : '')} onClick={() => { setAnchor(d); setView('day'); }}>
              {weekdayShort(d)} <i>{dayNum(d)}</i>
            </button>;
          })}
        </div>
        <div className="cal-allday" style={{ gridTemplateColumns: `var(--gutter) repeat(${days.length}, 1fr)`, minHeight: 10 + bandRows * 30 }}>
          <span className="cal-gut">all-day</span>
          {days.map((d, i) => <div key={d} className="cal-adcell" onClick={e => { if (e.target === e.currentTarget) newAt(d, 9 * 60, true); }}>
            {bands[i].map(ev => <button key={ev.id} className={'cal-chip' + (selected === ev.id ? ' sel' : '')} style={{ '--ev': color(ev.cal) } as React.CSSProperties} onClick={() => openEvent(ev)}>{ev.title}</button>)}
          </div>)}
        </div>
        <div className="cal-scroll" ref={scroller} onPointerDown={bodyDown} onPointerMove={bodyMove} onPointerUp={bodyUp} onPointerCancel={() => { gesture.current = null; if (dragRef.current) { clearTimeout(dragRef.current.timer); dragRef.current = null; setDrag(null); } }}>
          <div className="cal-hours" style={{ height: 24 * HOUR }}>
            <div className="cal-gutcol">{Array.from({ length: 23 }, (_, h) => days.includes(today) && Math.abs((h + 1) * 60 - nowMin) < 20 ? null : <span key={h} style={{ top: (h + 1) * HOUR }}>{h + 1 === 12 ? 'Noon' : <>{(h + 1) % 12 || 12}<small>{h + 1 < 12 ? 'am' : 'pm'}</small></>}</span>)}
              {days.includes(today) && <span className="cal-nowlbl" style={{ top: nowMin / 60 * HOUR }}>{clock(nowMin)}</span>}</div>
            <div className="cal-cols" ref={grid} style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
              {Array.from({ length: 23 }, (_, h) => <i key={h} className="cal-line" style={{ top: (h + 1) * HOUR }} />)}
              {days.map((day, di) => {
                const d0 = Date.parse(zonedToISO(day, 0)), d1 = Date.parse(zonedToISO(addDays(day, 1), 0));
                const items = layout(events.filter(e => !e.band && e.s < d1 && e.e > d0 || (!e.band && e.s === e.e && e.s >= d0 && e.s < d1)).map(ev => ({ ev, top: Math.max(0, (ev.s - d0) / 6e4), bot: Math.min(1440, Math.max((Math.min(ev.e, d1) - d0) / 6e4, (ev.s - d0) / 6e4 + 20)) })));
                const wk = (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7 >= 5;
                return <div key={day} className={'cal-col' + (wk && view === 'week' ? ' wkend' : '')}>
                  {items.map(({ ev, top, bot, col, cols }) => {
                    const dr = drag?.id === ev.id ? drag : null;
                    const t = top + (dr?.dTop ?? 0), b = Math.max(t + SNAP, bot + (dr?.dBot ?? 0));
                    const short = b - t < 45;
                    return <div key={ev.id} className={'cal-ev' + (selected === ev.id ? ' sel' : '') + (dr ? ' dragging' : '') + (ev.source === 'board' ? ' own' : '') + (short ? ' short' : '')}
                      style={{ '--ev': color(ev.cal), top: t / 60 * HOUR, height: Math.max(18, (b - t) / 60 * HOUR - 2), left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, transform: dr?.dDay ? `translateX(${dr.dDay * 100 * cols}%)` : undefined } as React.CSSProperties}
                      onPointerDown={e => evDown(e, ev, di)} onClick={e => clickEvent(e, ev)}>
                      <b>{alerts[ev.key] && <em className="cal-bell" aria-label="pops up">🔔 </em>}{ev.title}</b>{!short && <span>{clock(wall(new Date(ev.s)).min)}</span>}
                      {ev.source === 'board' && <i className="cal-grip" aria-hidden="true" />}
                    </div>;
                  })}
                  {day === today && <i className="cal-now" style={{ top: nowMin / 60 * HOUR }} />}
                </div>;
              })}
            </div>
            <Ink scope={inkScope} active={ink} onError={flash} />
          </div>
        </div>
      </div>
    );
  }

  function MonthView() {
    const cur = anchor.slice(0, 7);
    return (
      <div className="cal-month" onPointerDown={bodyDown} onPointerUp={e => { const g = gesture.current; gesture.current = null; if (g && Math.abs(e.clientX - g.x) > 120 && Math.abs(e.clientX - g.x) > 2 * Math.abs(e.clientY - g.y)) step(e.clientX < g.x ? 1 : -1); }}>
        <div className="cal-mhead">{days.slice(0, 7).map(d => <span key={d}>{weekdayShort(d)}</span>)}</div>
        <div className="cal-mgrid" ref={mgrid}>
          {days.map(d => {
            const evs = events.filter(e => e.sd <= d && e.ed > d).sort((a, b) => Number(b.band) - Number(a.band) || a.s - b.s);
            const wk = (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7 >= 5;
            const fit = Math.max(1, Math.floor((mgridH / 6 - 46) / 27));
            const show = evs.length > fit ? evs.slice(0, Math.max(0, fit - 1)) : evs;
            return <div key={d} className={'cal-mcell' + (d.slice(0, 7) !== cur ? ' out' : '') + (wk ? ' wkend' : '')} onClick={e => { if (e.target === e.currentTarget) newAt(d); }}>
              <button className={'cal-mnum' + (d === today ? ' today' : '')} onClick={() => { setAnchor(d); setView('day'); }}>{dayNum(d) === 1 ? `${dayNum(d)} ${monthAbbr(d)}` : dayNum(d)}</button>
              {show.map(ev => ev.band
                ? <button key={ev.id} className="cal-chip" style={{ '--ev': color(ev.cal) } as React.CSSProperties} onClick={() => openEvent(ev)}>{ev.title}</button>
                : <button key={ev.id} className="cal-mline" style={{ '--ev': color(ev.cal) } as React.CSSProperties} onClick={() => openEvent(ev)}><i />{ev.title}<small>{clock(wall(new Date(ev.s)).min)}</small></button>)}
              {evs.length > show.length && <button className="cal-more" onClick={() => { setAnchor(d); setView('day'); }}>{evs.length - show.length} more</button>}
            </div>;
          })}
        </div>
        <Ink scope={inkScope} active={ink} onError={flash} />
      </div>
    );
  }

  function YearView() {
    const y = anchor.slice(0, 4);
    return (
      <div className="cal-year">
        {Array.from({ length: 12 }, (_, m) => `${y}-${String(m + 1).padStart(2, '0')}-01`).map(m =>
          <MiniMonth key={m} month={m} today={today} onDay={d => { setAnchor(d); setView('day'); }} onMonth={() => { setAnchor(m); setView('month'); }} />)}
        <Ink scope={inkScope} active={ink} onError={flash} />
      </div>
    );
  }

  const dayList = view === 'day' ? events.filter(e => e.sd <= anchor && e.ed > anchor).sort((a, b) => Number(b.band) - Number(a.band) || a.s - b.s) : [];

  return (
    <>
    <main className={'cal' + (ink ? ' inking' : '')}>
      <Strip />
      <header className="cal-bar">
        <div className="cal-left">
          <div className="cal-pillgrp">
            <button aria-label="Calendars" className={calsOpen ? 'on' : ''} onClick={() => setCalsOpen(o => !o)}><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /><circle cx="8" cy="13" r=".9" /><circle cx="12" cy="13" r=".9" /><circle cx="16" cy="13" r=".9" /><circle cx="8" cy="16.5" r=".9" /><circle cx="12" cy="16.5" r=".9" /></svg></button>
            <i />
            <button aria-label="Pen" className={ink ? 'on' : ''} onClick={() => setInk(v => !v)}><svg viewBox="0 0 24 24"><path d="M4 20l1.2-4.6L16 4.6a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.6 18.8z" /><path d="M14 6.5l3.5 3.5" /></svg></button>
          </div>
          <button className="cal-round" aria-label="New event" onClick={() => newAt(today, Math.min(23 * 60, Math.ceil(wall(new Date()).min / 60) * 60))}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>
        </div>
        <nav className="cal-seg">{VIEWS.map(v => <button key={v} className={v === view ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</nav>
        <Link className="cal-round wide" href="/" aria-label="Family dashboard"><svg viewBox="0 0 24 24"><path d="M4 11l8-6.5 8 6.5M6.5 9.5V19h11V9.5" /></svg><span>Dashboard</span></Link>
      </header>
      <div className="cal-title">
        <h1>{title}</h1>
        {problems.length > 0 && <p className="cal-warn" title={problems.join('\n')}>⚠ {problems[0]}{problems.length > 1 ? ` (+${problems.length - 1})` : ''}</p>}
        <div className="cal-nav"><button aria-label="Previous" onClick={() => step(-1)}><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg></button><button className="txt" onClick={() => { setAnchor(todayDay()); }}>Today</button><button aria-label="Next" onClick={() => step(1)}><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></button></div>
      </div>

      <section className="cal-body">
        {view === 'week' && TimeGrid()}
        {view === 'day' && <div className="cal-dayview">{TimeGrid()}
          <aside className="cal-side">
            <MiniMonth month={startOfMonth(anchor)} today={today} selected={anchor} onDay={d => setAnchor(d)} onMonth={() => setView('month')} nav={n => setAnchor(a => addMonths(a, n))} />
            <h3>{anchor === today ? 'Today' : `${weekdayLong(anchor)} ${dayNum(anchor)} ${monthAbbr(anchor)}`}</h3>
            {dayList.length ? <ul className="cal-agenda">{dayList.map(ev => <li key={ev.id}><button style={{ '--ev': color(ev.cal) } as React.CSSProperties} onClick={() => openEvent(ev)}><i /><b>{ev.title}</b><small>{ev.band ? 'all-day' : `${clock(wall(new Date(ev.s)).min)} – ${clock(wall(new Date(ev.e)).min)}`}</small></button></li>)}</ul>
              : <p className="cal-empty">Nothing booked. Tap the grid to add something.</p>}
          </aside></div>}
        {view === 'month' && MonthView()}
        {view === 'year' && YearView()}
      </section>

      {ink && <InkHint />}

      {calsOpen && <div className="cal-pop cals" role="dialog" aria-label="Calendars">
        <h4>Calendars</h4>
        {CALS.map(c => <label key={c.id} style={{ '--ev': color(c.id) } as React.CSSProperties}><input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggleCal(c.id)} /><i />{c.label}{!c.writable && <small>read-only</small>}</label>)}
        <button className="cal-btn" onClick={() => setCalsOpen(false)}>Done</button>
      </div>}

      {detail && <Modal onClose={() => { setDetail(null); setSelected(null); }}>
        <div className="cal-detail" style={{ '--ev': color(detail.cal) } as React.CSSProperties}>
          <h2><i />{detail.title}</h2>
          <p>{detail.band ? `${weekdayLong(detail.sd)} ${dayNum(detail.sd)} ${monthName(detail.sd)} · all-day` : `${weekdayLong(wall(new Date(detail.s)).day)} ${dayNum(wall(new Date(detail.s)).day)} ${monthName(wall(new Date(detail.s)).day)} · ${clock(wall(new Date(detail.s)).min)} – ${clock(wall(new Date(detail.e)).min)}`}</p>
          <p className="muted">{CALS.find(c => c.id === detail.cal)?.label ?? detail.cal} · {SOURCE_NAME[detail.source]} · read-only here{detail.source === 'outlook' ? ' · pop-up applies to every repeat' : ''}</p>
          <AlertPicker value={alerts[detail.key] ?? 'off'} onChange={async m => { const err = await setAlert(detail.key, m); flash(err ?? (m === 'off' ? 'Pop-up off' : `${m === 'popup' ? 'Pop-up' : 'Pop-out'} on — fires 10 min before`)); }}
            onPreview={m => previewAlert({ key: detail.key, title: detail.title, startISO: new Date(Date.now() + 9 * 60_000 + 42_000).toISOString(), endISO: new Date(Date.now() + 9 * 60_000 + 42_000 + (detail.e - detail.s)).toISOString(), cal: detail.cal }, m)} />
          <div className="cal-actions">{detail.link && <a className="cal-btn" href={detail.link} target="_blank" rel="noreferrer">Open in Outlook</a>}<button className="cal-btn primary" onClick={() => { setDetail(null); setSelected(null); }}>Done</button></div>
        </div>
      </Modal>}

      {draft && <Editor draft={draft} onCancel={() => { setDraft(null); setSelected(null); }} onSave={save} onDelete={remove} />}
      {toast && <div className="cal-toast" role="status">{toast}</div>}
    </main>
    <EventAlerts />
    </>
  );
}

/** Off / Pop-out / Pop-up for one event series, with a Preview. */
function AlertPicker({ value, onChange, onPreview }: { value: AlertMode | 'off'; onChange: (m: AlertMode | 'off') => void; onPreview: (m: AlertMode) => void }) {
  return (
    <div className="cal-row"><span>Alert</span>
      <div className="cal-quick">{(['off', 'popout', 'popup'] as const).map(m => <button type="button" key={m} className={value === m ? 'on' : ''} onClick={() => onChange(m)}>{m === 'off' ? 'Off' : m === 'popout' ? 'Pop-out' : 'Pop-up'}</button>)}
        <button type="button" className="ghost" onClick={() => onPreview(value === 'off' ? 'popup' : value)}>▶ Preview</button></div>
    </div>
  );
}

function InkHint() {
  return <div className="cal-inkhint">Pen on — write anywhere. Tap the pen again to stop.</div>;
}

function MiniMonth({ month, today, selected, onDay, onMonth, nav }: { month: string; today: string; selected?: string; onDay: (d: string) => void; onMonth: () => void; nav?: (n: number) => void }) {
  const cur = month.slice(0, 7), cells = monthGrid(month);
  return (
    <div className="cal-mini">
      <div className="cal-mini-head">
        <button className={'cal-mini-name' + (today.slice(0, 7) === cur ? ' now' : '')} onClick={onMonth}>{monthName(month)}{nav ? ` ${month.slice(0, 4)}` : ''}</button>
        {nav && <span><button aria-label="Previous month" onClick={() => nav(-1)}>‹</button><button aria-label="Next month" onClick={() => nav(1)}>›</button></span>}
      </div>
      <div className="cal-mini-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="wd">{d}</span>)}
        {cells.map(d => <button key={d} className={(d.slice(0, 7) !== cur ? 'out' : '') + (d === today ? ' today' : '') + (d === selected ? ' sel' : '')} onClick={() => onDay(d)}>{dayNum(d)}</button>)}
      </div>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="cal-scrim" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="cal-sheet" role="dialog" aria-modal="true">{children}</div></div>;
}

function Editor({ draft, onCancel, onSave, onDelete }: { draft: Draft; onCancel: () => void; onSave: (d: Draft) => Promise<string | null>; onDelete: (id: string) => Promise<string | null> }) {
  const [d, setD] = useState(draft), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [sure, setSure] = useState(false);
  const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }));
  const dur = d.endMin - d.startMin;
  const moveStart = (n: number) => { const s = Math.max(0, Math.min(24 * 60 - SNAP, d.startMin + n)); set({ startMin: s, endMin: Math.min(24 * 60, s + Math.max(SNAP, dur)) }); };
  const moveEnd = (n: number) => set({ endMin: Math.max(d.startMin + SNAP, Math.min(24 * 60, d.endMin + n)) });
  async function run(p: Promise<string | null>) { setBusy(true); setErr(''); const e = await p; setBusy(false); if (e) setErr(e); }
  return (
    <Modal onClose={onCancel}>
      <form className="cal-editor" onSubmit={e => { e.preventDefault(); run(onSave(d)); }}>
        <input className="cal-titlein" autoFocus={!d.id} placeholder="New event" value={d.title} maxLength={200} onChange={e => set({ title: e.target.value })} aria-label="Title" />
        <div className="cal-calpick" role="radiogroup" aria-label="Calendar">{CALS.filter(c => c.writable).map(c => <button type="button" key={c.id} role="radio" aria-checked={d.cal === c.id} className={d.cal === c.id ? 'on' : ''} style={{ '--ev': color(c.id) } as React.CSSProperties} onClick={() => set({ cal: c.id })}><i />{c.label}</button>)}</div>
        <div className="cal-row"><span>Day</span><div className="cal-step"><button type="button" onClick={() => set({ day: addDays(d.day, -1) })}>‹</button><b>{weekdayShort(d.day)} {dayNum(d.day)} {monthAbbr(d.day)} {d.day.slice(0, 4)}</b><button type="button" onClick={() => set({ day: addDays(d.day, 1) })}>›</button></div></div>
        <div className="cal-row"><span>All-day</span><button type="button" role="switch" aria-checked={d.allDay} className={'cal-switch' + (d.allDay ? ' on' : '')} onClick={() => set({ allDay: !d.allDay })}><i /></button></div>
        {!d.allDay && <>
          <div className="cal-row"><span>Starts</span><div className="cal-step"><button type="button" onClick={() => moveStart(-60)}>−1h</button><button type="button" onClick={() => moveStart(-SNAP)}>−15</button><b>{clock(d.startMin)}</b><button type="button" onClick={() => moveStart(SNAP)}>+15</button><button type="button" onClick={() => moveStart(60)}>+1h</button></div></div>
          <div className="cal-row"><span>Ends</span><div className="cal-step"><button type="button" onClick={() => moveEnd(-60)}>−1h</button><button type="button" onClick={() => moveEnd(-SNAP)}>−15</button><b>{d.endMin >= 1440 ? 'Midnight' : clock(d.endMin)}</b><button type="button" onClick={() => moveEnd(SNAP)}>+15</button><button type="button" onClick={() => moveEnd(60)}>+1h</button></div></div>
          <div className="cal-row"><span>Length</span><div className="cal-quick">{[30, 60, 90, 120, 180].map(m => <button type="button" key={m} className={dur === m ? 'on' : ''} onClick={() => set({ endMin: Math.min(1440, d.startMin + m) })}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>)}</div></div>
        </>}
        <AlertPicker value={d.alert} onChange={m => set({ alert: m })} onPreview={m => previewAlert({ key: d.id ? `board-${d.id}` : `draft-${d.title}`, title: d.title || 'New event', startISO: new Date(Date.now() + 9 * 60_000 + 42_000).toISOString(), endISO: new Date(Date.now() + (9 * 60 + 42) * 1000 + (d.endMin - d.startMin) * 60_000).toISOString(), cal: d.cal }, m)} />
        <textarea placeholder="Notes" value={d.notes} maxLength={2000} rows={2} onChange={e => set({ notes: e.target.value })} aria-label="Notes" />
        {err && <p className="cal-err" role="alert">{err}</p>}
        <div className="cal-actions">
          {d.id && (sure ? <button type="button" className="cal-btn danger" disabled={busy} onClick={() => run(onDelete(d.id!))}>Tap again to delete</button> : <button type="button" className="cal-btn danger ghost" onClick={() => setSure(true)}>Delete</button>)}
          <span />
          <button type="button" className="cal-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="cal-btn primary" disabled={busy || !d.title.trim()}>{busy ? 'Saving…' : d.id ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}
