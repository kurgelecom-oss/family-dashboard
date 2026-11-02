'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import './hourly-shift.css';
import { TZ, addDays, today, wall } from '../lib/cal-time';

/* Every hour, on the hour, the home board hands the TV to the calendar for 30
   seconds and takes it back — with a slow ivory cross-dissolve each way. Lives in the root
   layout, which survives client navigation, so one overlay covers the old page,
   the route changes underneath it, and the same overlay reveals the new page.
   If someone touches the calendar during its 30 s, it stays (they're using it).
   No timed events left today (routines and all-day items don't count) → the hour
   is skipped and the home screen stays put.
   The way back is a deadline in sessionStorage, not component state: a TV left open
   across a deploy gets a full page load when it navigates (Next build skew), which
   used to wipe the countdown and strand it on the calendar.
   Test it any time with /?shift=now (always runs). Only "/" starts it; other routes never move. */

type Phase = 'idle' | 'cover' | 'reveal';
const COVER_MS = 2300, REVEAL_MS = 1900, STAY_MS = 30_000;
const hourKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(new Date());
const minuteNow = () => Number(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, minute: 'numeric' }).format(new Date()));
const BACK = 'hs-back-at'; // epoch ms when the calendar hands the TV back
const backAt = () => Number(sessionStorage.getItem(BACK)) || 0;

type Ev = { startISO: string; endISO: string; allDay?: boolean; cal?: string; source?: string };
/** Is anything still to come (or happening) today? Unknown (fetch failed) counts as yes. */
async function eventsLeftToday() {
  const day = today(), to = addDays(day, 1), now = Date.now();
  try {
    const lists = await Promise.all([`/api/cal?from=${day}&to=${to}`, `/api/cal/events?from=${day}&to=${to}`]
      .map(u => fetch(u, { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(r.status)))));
    return lists.flatMap(b => (b.events ?? []) as Ev[])
      .some(e => !e.allDay && e.cal !== 'routine' && e.source !== 'routine' && wall(e.startISO).day === day && Date.parse(e.endISO) > now);
  } catch { return true; }
}

const clockNow = () => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date()).replace(' ', '').toLowerCase();

export default function HourlyShift() {
  const path = usePathname(), router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [label, setLabel] = useState('');
  const [left, setLeft] = useState<number | null>(null);
  const trip = useRef<{ to: '/board' | '/'; } | null>(null);
  const fired = useRef('');

  function go(to: '/board' | '/') {
    if (trip.current) return;
    trip.current = { to };
    if (to === '/board') sessionStorage.setItem(BACK, String(Date.now() + COVER_MS + 2500 + STAY_MS)); else sessionStorage.removeItem(BACK);
    setLabel(to === '/board' ? 'Calendar' : 'Dashboard');
    setPhase('cover');
    setTimeout(() => router.push(to === '/board' ? '/board?view=week' : '/'), COVER_MS);
  }

  // The route changed under the cover → reveal the new page once it has had a moment to paint.
  useEffect(() => {
    const t = trip.current;
    if (!t || (t.to === '/board' ? !path.startsWith('/board') : path !== '/')) return;
    // Reveal only once the new page has rendered and the main thread is quiet, so the
    // wipe never competes with the page's first paint (that was the stutter).
    let live = true, idle = 0;
    const reveal = () => {
      if (!live) return;
      setPhase('reveal');
      setTimeout(() => { setPhase('idle'); trip.current = null; }, REVEAL_MS);
    };
    const r = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      idle = 'requestIdleCallback' in window ? window.requestIdleCallback(reveal, { timeout: 1200 }) : setTimeout(reveal, 300) as unknown as number;
    })), 900);
    return () => { live = false; clearTimeout(r); if (idle && 'cancelIdleCallback' in window) window.cancelIdleCallback(idle); };
  }, [path]);

  // On the hour from "/" (and /?shift=now for a test).
  useEffect(() => {
    router.prefetch('/board');
    const tick = () => {
      if (path !== '/' || document.hidden || trip.current) return;
      const k = hourKey();
      if (minuteNow() === 0 && fired.current !== k) { fired.current = k; void eventsLeftToday().then(any => { if (any && !trip.current) go('/board'); }); }
    };
    if (path === '/' && new URLSearchParams(window.location.search).get('shift') === 'now') { history.replaceState(null, '', '/'); go('/board'); }
    const i = setInterval(tick, 5000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go/router are stable for this purpose
  }, [path]);

  // 30 s on the calendar, then home — unless someone starts using it. Reads the stored
  // deadline, so it also resumes after a full page load.
  useEffect(() => {
    if (!path.startsWith('/board')) { if (!trip.current) sessionStorage.removeItem(BACK); return; }
    if (!backAt()) return;
    const tick = () => {
      const at = backAt(); if (!at) return;
      const s = Math.ceil((at - Date.now()) / 1000);
      if (s > 0) { setLeft(Math.min(s, STAY_MS / 1000)); return; }
      sessionStorage.removeItem(BACK); setLeft(null); go('/');
    };
    const stay = () => { sessionStorage.removeItem(BACK); setLeft(null); };
    tick();
    const i = setInterval(tick, 1000);
    window.addEventListener('pointerdown', stay);
    return () => { clearInterval(i); window.removeEventListener('pointerdown', stay); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go/router are stable for this purpose
  }, [path]);

  return <>
    {phase !== 'idle' && <div className={`hs-layer ${phase}`} aria-hidden="true">
      <i className="hs-veil" />
      <div className="hs-word"><small>{clockNow()}</small><b>{label}</b><i className="hs-line" /><em>Kurgel family</em></div>
    </div>}
    {left !== null && left > 0 && phase === 'idle' && path.startsWith('/board') && <div className="hs-pill" role="status"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" /><circle className="fg" cx="18" cy="18" r="15" style={{ strokeDashoffset: 94.25 * (1 - left / (STAY_MS / 1000)) }} /></svg>Back to the dashboard in {left}s · tap anywhere to stay</div>}
  </>;
}
